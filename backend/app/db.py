"""Database abstraction for CloudPulse.

MongoDB Atlas (or any MongoDB server) is used when ``MONGO_URI`` is configured
and reachable. Otherwise the application automatically falls back to a local
SQLite document store so that the project is runnable with zero external
services. Both backends expose the same small document-store interface.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from .utils import iso, new_id

logger = logging.getLogger(__name__)


class Store:
    """Tiny document store with the subset of operations CloudPulse needs."""

    def __init__(self, config: dict):
        self.config = config
        self._lock = threading.RLock()
        self._mongo_client = None
        self._mongo_db = None
        self.backend = "sqlite"
        self.backend_detail = ""
        self._sqlite_path = Path(config["DATABASE_PATH"])
        self._sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_sqlite()

        uri = config.get("MONGO_URI")
        if uri:
            try:
                from pymongo import MongoClient

                client = MongoClient(
                    uri,
                    serverSelectionTimeoutMS=2500,
                    connectTimeoutMS=2500,
                    appname="CloudPulse",
                )
                client.admin.command("ping")
                self._mongo_client = client
                self._mongo_db = client[config["MONGO_DB"]]
                self.backend = "mongodb"
                self.backend_detail = f"MongoDB database '{config['MONGO_DB']}'"
                logger.info("Connected to MongoDB (%s)", config["MONGO_DB"])
            except Exception as exc:  # noqa: BLE001 - fallback is intentional
                logger.warning(
                    "MongoDB unavailable (%s). Falling back to SQLite at %s",
                    type(exc).__name__,
                    self._sqlite_path,
                )
                self._mongo_client = None
                self._mongo_db = None
                self.backend = "sqlite"
                self.backend_detail = "SQLite fallback (set MONGO_URI for MongoDB Atlas)"
        else:
            self.backend_detail = "SQLite local fallback (set MONGO_URI for MongoDB Atlas)"

        self.ensure_indexes()

    # ------------------------------------------------------------------
    # SQLite setup
    # ------------------------------------------------------------------
    def _connect(self):
        connection = sqlite3.connect(self._sqlite_path, timeout=30)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.row_factory = sqlite3.Row
        return connection

    def _init_sqlite(self):
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS documents (
                    collection TEXT NOT NULL,
                    id TEXT NOT NULL,
                    data TEXT NOT NULL,
                    PRIMARY KEY (collection, id)
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection)"
            )

    def ensure_indexes(self):
        if self.backend == "mongodb":
            db = self._mongo_db
            db.users.create_index("email", unique=True)
            db.users.create_index("id", unique=True)
            db.servers.create_index("id", unique=True)
            db.servers.create_index("agent_key_hash", sparse=True)
            db.servers.create_index([("data_source", 1), ("name", 1)])
            db.telemetry.create_index([("server_id", 1), ("timestamp", -1)])
            db.telemetry.create_index("timestamp")
            db.telemetry.create_index([("data_source", 1), ("timestamp", -1)])
            db.alerts.create_index([("server_id", 1), ("category", 1), ("status", 1)])
            db.alerts.create_index([("status", 1), ("created_at", -1)])
            db.anomalies.create_index([("server_id", 1), ("timestamp", -1)])
            db.reports.create_index("created_at")
            db.revoked_tokens.create_index("expires_at")
            return

        statements = [
            "CREATE INDEX IF NOT EXISTS idx_docs_collection ON documents(collection)",
            "CREATE INDEX IF NOT EXISTS idx_users_email ON documents(collection, json_extract(data,'$.email'))",
            "CREATE INDEX IF NOT EXISTS idx_servers_source ON documents(collection, json_extract(data,'$.data_source'), json_extract(data,'$.name'))",
            "CREATE INDEX IF NOT EXISTS idx_servers_agent ON documents(collection, json_extract(data,'$.agent_key_hash'))",
            "CREATE INDEX IF NOT EXISTS idx_telemetry_server_time ON documents(collection, json_extract(data,'$.server_id'), json_extract(data,'$.timestamp'))",
            "CREATE INDEX IF NOT EXISTS idx_telemetry_time ON documents(collection, json_extract(data,'$.timestamp'))",
            "CREATE INDEX IF NOT EXISTS idx_alerts_open ON documents(collection, json_extract(data,'$.server_id'), json_extract(data,'$.category'), json_extract(data,'$.status'))",
            "CREATE INDEX IF NOT EXISTS idx_anomalies_time ON documents(collection, json_extract(data,'$.timestamp'))",
            "CREATE INDEX IF NOT EXISTS idx_reports_created ON documents(collection, json_extract(data,'$.created_at'))",
        ]
        with self._connect() as connection:
            for statement in statements:
                connection.execute(statement)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _prepare(document: dict) -> dict:
        prepared = {}
        for key, value in document.items():
            if key == "_id":
                continue
            if isinstance(value, datetime):
                prepared[key] = iso(value)
            elif isinstance(value, (str, int, float, bool)) or value is None:
                prepared[key] = value
            elif isinstance(value, (list, dict)):
                prepared[key] = json.loads(json.dumps(value, default=lambda item: iso(item) if isinstance(item, datetime) else str(item)))
            else:
                prepared[key] = str(value)
        prepared.setdefault("id", new_id())
        return prepared

    @staticmethod
    def _from_sqlite(row) -> dict:
        document = json.loads(row["data"])
        document.pop("_id", None)
        return document

    @staticmethod
    def _sql_value(value: Any):
        if isinstance(value, bool):
            return 1 if value else 0
        if isinstance(value, (int, float, str)) or value is None:
            return value
        return json.dumps(value)

    def _compile_query(self, query: dict | None) -> tuple[str, list]:
        query = query or {}
        clauses: list[str] = []
        params: list[Any] = []
        for key, value in query.items():
            if key == "$or":
                if not isinstance(value, list):
                    raise ValueError("$or must be a list")
                subclauses = []
                for subquery in value:
                    clause, subparams = self._compile_query(subquery)
                    subclauses.append(f"({clause})")
                    params.extend(subparams)
                clauses.append("(" + " OR ".join(subclauses) + ")")
                continue
            path = f"json_extract(data, '$.{key}')"
            if isinstance(value, dict) and any(str(op).startswith("$") for op in value):
                for operator, operand in value.items():
                    if operator == "$in":
                        if not isinstance(operand, list):
                            raise ValueError("$in requires a list")
                        if not operand:
                            clauses.append("0=1")
                            continue
                        placeholders = ",".join("?" for _ in operand)
                        clauses.append(f"{path} IN ({placeholders})")
                        params.extend(self._sql_value(item) for item in operand)
                    elif operator == "$nin":
                        if not operand:
                            continue
                        placeholders = ",".join("?" for _ in operand)
                        clauses.append(f"{path} NOT IN ({placeholders})")
                        params.extend(self._sql_value(item) for item in operand)
                    elif operator in {"$gte", "$lte", "$gt", "$lt"}:
                        sql_operator = {
                            "$gte": ">=",
                            "$lte": "<=",
                            "$gt": ">",
                            "$lt": "<",
                        }[operator]
                        clauses.append(f"{path} {sql_operator} ?")
                        params.append(self._sql_value(operand))
                    elif operator == "$ne":
                        clauses.append(f"COALESCE({path}, '') != ?")
                        params.append(self._sql_value(operand))
                    elif operator == "$exists":
                        clauses.append(f"{path} IS {'NOT ' if operand else ''}NULL")
                    else:
                        raise ValueError(f"Unsupported query operator: {operator}")
            elif value is None:
                clauses.append(f"{path} IS NULL")
            else:
                clauses.append(f"{path} = ?")
                params.append(self._sql_value(value))
        return (" AND ".join(clauses) if clauses else "1=1"), params

    def _normalize_sort(self, sort) -> list[tuple[str, int]]:
        if not sort:
            return []
        if isinstance(sort, str):
            sort = [sort]
        if isinstance(sort, tuple) and len(sort) == 2 and isinstance(sort[0], str):
            sort = [sort]
        normalized = []
        for field, direction in sort:
            normalized.append((field, 1 if direction in (1, "asc", "ASC") else -1))
        return normalized

    # ------------------------------------------------------------------
    # CRUD interface
    # ------------------------------------------------------------------
    def insert(self, collection: str, document: dict) -> dict:
        document = self._prepare(document)
        if self.backend == "mongodb":
            self._mongo_db[collection].insert_one(document.copy())
        else:
            with self._lock, self._connect() as connection:
                connection.execute(
                    "INSERT INTO documents(collection, id, data) VALUES (?, ?, ?)",
                    (collection, document["id"], json.dumps(document)),
                )
        return document

    def insert_many(self, collection: str, documents: list[dict]) -> int:
        if not documents:
            return 0
        prepared = [self._prepare(document) for document in documents]
        if self.backend == "mongodb":
            self._mongo_db[collection].insert_many([doc.copy() for doc in prepared], ordered=False)
        else:
            with self._lock, self._connect() as connection:
                connection.executemany(
                    "INSERT OR REPLACE INTO documents(collection, id, data) VALUES (?, ?, ?)",
                    [(collection, doc["id"], json.dumps(doc)) for doc in prepared],
                )
        return len(prepared)

    def find(
        self,
        collection: str,
        query: dict | None = None,
        *,
        sort=None,
        limit: int | None = None,
        skip: int = 0,
    ) -> list[dict]:
        query = query or {}
        if self.backend == "mongodb":
            cursor = self._mongo_db[collection].find(query, {"_id": 0})
            normalized_sort = self._normalize_sort(sort)
            if normalized_sort:
                cursor = cursor.sort(normalized_sort)
            if skip:
                cursor = cursor.skip(skip)
            if limit:
                cursor = cursor.limit(limit)
            return list(cursor)

        clause, params = self._compile_query(query)
        sql = f"SELECT data FROM documents WHERE collection = ? AND {clause}"
        normalized_sort = self._normalize_sort(sort)
        if normalized_sort:
            order_parts = []
            for field, direction in normalized_sort:
                order_parts.append(
                    f"json_extract(data, '$.{field}') {'DESC' if direction == -1 else 'ASC'}"
                )
            sql += " ORDER BY " + ", ".join(order_parts)
        if limit:
            sql += " LIMIT ? OFFSET ?"
            params.extend([int(limit), int(skip)])
        elif skip:
            sql += " LIMIT -1 OFFSET ?"
            params.append(int(skip))
        with self._connect() as connection:
            rows = connection.execute(sql, [collection, *params]).fetchall()
        return [self._from_sqlite(row) for row in rows]

    def find_one(self, collection: str, query: dict | None = None, *, sort=None) -> dict | None:
        results = self.find(collection, query, sort=sort, limit=1)
        return results[0] if results else None

    def count(self, collection: str, query: dict | None = None) -> int:
        query = query or {}
        if self.backend == "mongodb":
            return int(self._mongo_db[collection].count_documents(query))
        clause, params = self._compile_query(query)
        with self._connect() as connection:
            row = connection.execute(
                f"SELECT COUNT(*) AS total FROM documents WHERE collection = ? AND {clause}",
                [collection, *params],
            ).fetchone()
        return int(row["total"])

    def update(
        self,
        collection: str,
        query: dict,
        patch: dict,
        *,
        upsert: bool = False,
    ) -> dict | None:
        existing = self.find_one(collection, query)
        if existing is None:
            if not upsert:
                return None
            base = {key: value for key, value in query.items() if not key.startswith("$")}
            base.update({key: value for key, value in patch.items() if not key.startswith("$")})
            return self.insert(collection, base)

        patch = {key: value for key, value in patch.items() if key not in {"id", "_id"}}
        merged = {**existing, **patch}
        merged["id"] = existing["id"]
        merged = self._prepare(merged)
        if self.backend == "mongodb":
            self._mongo_db[collection].replace_one({"id": existing["id"]}, merged)
        else:
            with self._lock, self._connect() as connection:
                connection.execute(
                    "UPDATE documents SET data = ? WHERE collection = ? AND id = ?",
                    (json.dumps(merged), collection, existing["id"]),
                )
        return merged

    def delete(self, collection: str, query: dict) -> int:
        if self.backend == "mongodb":
            result = self._mongo_db[collection].delete_many(query)
            return int(result.deleted_count)
        matches = self.find(collection, query)
        if not matches:
            return 0
        ids = [doc["id"] for doc in matches]
        with self._lock, self._connect() as connection:
            placeholders = ",".join("?" for _ in ids)
            connection.execute(
                f"DELETE FROM documents WHERE collection = ? AND id IN ({placeholders})",
                [collection, *ids],
            )
        return len(ids)

    def delete_by_id(self, collection: str, document_id: str) -> bool:
        return self.delete(collection, {"id": document_id}) > 0

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------
    def health(self) -> dict:
        if self.backend == "mongodb":
            try:
                self._mongo_client.admin.command("ping")
                connected = True
                detail = self.backend_detail
            except Exception as exc:  # noqa: BLE001
                connected = False
                detail = f"MongoDB ping failed: {type(exc).__name__}"
        else:
            try:
                with self._connect() as connection:
                    connection.execute("SELECT 1").fetchone()
                connected = True
                detail = self.backend_detail
            except Exception as exc:  # noqa: BLE001
                connected = False
                detail = f"SQLite error: {type(exc).__name__}"
        return {"backend": self.backend, "connected": connected, "detail": detail}

    def close(self):
        if self._mongo_client is not None:
            try:
                self._mongo_client.close()
            except Exception:  # noqa: BLE001
                pass

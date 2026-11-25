#!/usr/bin/env python3
"""CloudPulse lightweight telemetry agent.

Install requirements (psutil) and run:

    python agent/cloudpulse_agent.py \
        --url https://cloudpulse-api.onrender.com \
        --key cp_live_xxxxxxxxx \
        --interval 5

The agent sends real CPU, memory, disk, network and uptime measurements from
the machine it runs on. It never generates simulated values.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request

try:
    import psutil
except ImportError:  # pragma: no cover
    print("psutil is required. Install it with: pip install psutil", file=sys.stderr)
    raise SystemExit(1)


def request_json(url: str, *, method: str = "GET", payload: dict | None = None, key: str | None = None, timeout: float = 10):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if key:
        request.add_header("X-Agent-Key", key)
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def api_latency_ms(base_url: str) -> float:
    started = time.perf_counter()
    try:
        request_json(f"{base_url}/api/health", timeout=5)
    except Exception:  # noqa: BLE001
        pass
    return round((time.perf_counter() - started) * 1000, 1)


def collect(base_url: str, previous_network: tuple[float, int, int] | None):
    # Sample over a short window so the first report is meaningful too.
    cpu = psutil.cpu_percent(interval=0.1)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage(os.path.abspath(os.sep))
    counters = psutil.net_io_counters()
    now = time.time()
    if previous_network:
        elapsed = max(0.001, now - previous_network[0])
        in_bps = max(0, (counters.bytes_recv - previous_network[1]) / elapsed)
        out_bps = max(0, (counters.bytes_sent - previous_network[2]) / elapsed)
    else:
        in_bps = out_bps = 0.0
    uptime = max(0.0, now - psutil.boot_time())
    load = 0.0
    if hasattr(psutil, "getloadavg"):
        try:
            load = float(psutil.getloadavg()[0])
        except Exception:  # noqa: BLE001
            load = 0.0

    payload = {
        "cpu_percent": round(float(cpu), 2),
        "memory_percent": round(float(memory.percent), 2),
        "memory_total_mb": round(memory.total / 1024 / 1024, 1),
        "memory_available_mb": round(memory.available / 1024 / 1024, 1),
        "disk_percent": round(float(disk.percent), 2),
        "network_in_bps": int(in_bps),
        "network_out_bps": int(out_bps),
        "uptime_seconds": int(uptime),
        "load_average": round(load, 2),
        "response_time_ms": api_latency_ms(base_url),
        "hostname": socket.gethostname(),
        "os": f"{platform.system()} {platform.release()}",
    }
    return payload, (now, counters.bytes_recv, counters.bytes_sent)


def main() -> int:
    parser = argparse.ArgumentParser(description="CloudPulse telemetry agent")
    parser.add_argument("--url", required=True, help="CloudPulse API base URL, e.g. https://api.example.com")
    parser.add_argument("--key", required=True, help="One-time agent key created in the dashboard")
    parser.add_argument("--interval", type=int, default=5, help="Collection interval in seconds (default: 5)")
    parser.add_argument("--once", action="store_true", help="Send one sample and exit")
    args = parser.parse_args()

    base_url = args.url.rstrip("/")
    if base_url.endswith("/api"):
        base_url = base_url[:-4]
    interval = max(2, min(3600, args.interval))

    try:
        _, validation = request_json(f"{base_url}/api/telemetry/validate", key=args.key)
    except urllib.error.HTTPError as exc:
        print(f"Agent key validation failed (HTTP {exc.code}). Create a new key in the dashboard.", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"Cannot reach CloudPulse at {base_url}: {exc}", file=sys.stderr)
        return 1

    print(f"CloudPulse agent connected to {base_url} as '{validation.get('server_name')}'.")
    print(f"Collecting real host telemetry every {interval}s. Press Ctrl+C to stop.")
    psutil.cpu_percent(interval=None)
    previous_network = None
    failures = 0

    try:
        while True:
            try:
                payload, previous_network = collect(base_url, previous_network)
                status, response = request_json(
                    f"{base_url}/api/telemetry/ingest",
                    method="POST",
                    payload=payload,
                    key=args.key,
                )
                server = response.get("server", {})
                print(
                    f"[{time.strftime('%H:%M:%S')}] CPU {payload['cpu_percent']:5.1f}% | "
                    f"MEM {payload['memory_percent']:5.1f}% | DISK {payload['disk_percent']:5.1f}% | "
                    f"NET {(payload['network_in_bps'] + payload['network_out_bps']) / 1e6:7.2f} Mbps | "
                    f"health {server.get('health_score', '-')}"
                )
                failures = 0
                if args.once:
                    return 0
            except urllib.error.HTTPError as exc:
                failures += 1
                body = exc.read().decode("utf-8", "replace")[:200]
                print(f"Ingest failed (HTTP {exc.code}): {body}", file=sys.stderr)
                if exc.code in {401, 403}:
                    return 1
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"Ingest failed: {exc}", file=sys.stderr)
            time.sleep(min(60, interval * (2 if failures > 3 else 1)))
    except KeyboardInterrupt:
        print("\nAgent stopped.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

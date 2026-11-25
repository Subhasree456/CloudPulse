"""Report generation: JSON summaries, CSV exports and PDF documents."""
from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from xml.sax.saxutils import escape

from ..utils import iso, new_id, parse_iso, utcnow
from .analytics import analytics, build_series, data_source_for, load_rows, server_snapshot, availability_percent
from .events import emit_event
from .settings import get_settings

REPORT_LABELS = {"daily": "Daily infrastructure report", "weekly": "Weekly infrastructure report"}


def _day_bounds(report_type: str, date_value: str | None) -> tuple[datetime, datetime, str]:
    if date_value:
        try:
            base_date = datetime.strptime(date_value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            raise ValueError("Date must use the YYYY-MM-DD format.") from None
    else:
        base_date = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    if report_type == "weekly":
        end = base_date + timedelta(days=1)
        start = end - timedelta(days=7)
        label = f"{start.date().isoformat()} to {(end - timedelta(days=1)).date().isoformat()}"
    else:
        start = base_date
        end = base_date + timedelta(days=1)
        label = base_date.date().isoformat()
    return start, end, label


def build_report_data(
    store,
    settings: dict | None = None,
    *,
    report_type: str = "daily",
    date_value: str | None = None,
    source: str | None = None,
) -> dict:
    if report_type not in {"daily", "weekly"}:
        raise ValueError("Report type must be daily or weekly.")
    settings = settings or get_settings(store)
    start, end, label = _day_bounds(report_type, date_value)
    source = source or data_source_for(settings)
    seconds = int((end - start).total_seconds())
    range_info = {
        "start": start,
        "end": end,
        "seconds": seconds,
        "label": "custom",
        "bucket_seconds": max(60, seconds // 60),
        "start_iso": iso(start),
        "end_iso": iso(end),
    }
    data = analytics(store, settings, range_info)
    servers = []
    for raw_server in store.find("servers", {"data_source": source}, sort=[("name", 1)]):
        snapshot = server_snapshot(raw_server, settings)
        snapshot["availability"] = availability_percent(raw_server, start, end)
        servers.append(snapshot)
    alerts = store.find(
        "alerts",
        {"data_source": source, "created_at": {"$gte": range_info["start_iso"], "$lte": range_info["end_iso"]}},
        sort=[("created_at", -1)],
        limit=200,
    )
    anomalies = store.find(
        "anomalies",
        {"data_source": source, "timestamp": {"$gte": range_info["start_iso"], "$lte": range_info["end_iso"]}},
        sort=[("timestamp", -1)],
        limit=200,
    )
    active_alerts = [alert for alert in alerts if alert.get("status") in {"active", "acknowledged"}]
    anomaly_by_severity = defaultdict(int)
    for anomaly in anomalies:
        anomaly_by_severity[anomaly.get("severity", "warning")] += 1

    return {
        "id": new_id("report_"),
        "type": report_type,
        "title": REPORT_LABELS[report_type],
        "period": label,
        "start": range_info["start_iso"],
        "end": range_info["end_iso"],
        "generated_at": iso(),
        "mode": settings.get("mode", "demo"),
        "data_source": source,
        "simulated": source == "simulated",
        "summary": {
            "servers": len(servers),
            "avg_cpu": data["totals"]["avg_cpu"],
            "avg_memory": data["totals"]["avg_memory"],
            "avg_availability": data["totals"]["avg_availability"],
            "active_alerts": len(active_alerts),
            "alerts_total": len(alerts),
            "anomalies": len(anomalies),
            "critical_anomalies": anomaly_by_severity.get("critical", 0),
            "samples": data["totals"]["samples"],
        },
        "servers": servers,
        "alerts": alerts,
        "anomalies": anomalies,
        "series": data["series"],
        "daily": data["daily"],
        "costs": data["costs"],
        "notes": data["notes"],
    }


def list_reports(store, limit: int = 20) -> list[dict]:
    return store.find("reports", {}, sort=[("created_at", -1)], limit=limit)


def record_report(store, report: dict, *, created_by: str, file_format: str) -> dict:
    record = {
        "id": new_id("rpt_"),
        "report_type": report["type"],
        "title": report["title"],
        "period": report["period"],
        "start": report["start"],
        "end": report["end"],
        "data_source": report["data_source"],
        "format": file_format,
        "summary": report["summary"],
        "created_by": created_by,
        "created_at": iso(),
    }
    record = store.insert("reports", record)
    emit_event("report:created", record)
    return record


def _fmt(value, digits: int = 1, suffix: str = "") -> str:
    try:
        return f"{float(value):.{digits}f}{suffix}"
    except (TypeError, ValueError):
        return "-"


def generate_pdf(report: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        KeepTogether,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    buffer = io.BytesIO()
    navy = colors.HexColor("#0B1220")
    blue = colors.HexColor("#2563EB")
    cyan = colors.HexColor("#0891B2")
    muted = colors.HexColor("#64748B")
    light = colors.HexColor("#F1F5F9")
    line = colors.HexColor("#CBD5E1")
    amber = colors.HexColor("#B45309")
    red = colors.HexColor("#B91C1C")

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=report["title"],
        author="CloudPulse",
        subject="Cloud infrastructure monitoring report",
    )
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="CloudTitle",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            textColor=navy,
            spaceAfter=2,
            alignment=0,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CloudSub",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9,
            textColor=muted,
            spaceAfter=12,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Section",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            textColor=navy,
            spaceBefore=14,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Small",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=11,
            textColor=colors.HexColor("#334155"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="Banner",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=11,
            textColor=amber if report["simulated"] else colors.HexColor("#166534"),
        )
    )

    story = []
    story.append(Paragraph("CloudPulse", styles["CloudTitle"]))
    story.append(Paragraph("Monitor. Analyse. Optimise.", styles["CloudSub"]))
    story.append(Paragraph(escape(report["title"]), ParagraphStyle(
        "ReportHeading", parent=styles["Heading1"], fontName="Helvetica-Bold",
        fontSize=15, textColor=blue, spaceAfter=4,
    )))
    story.append(
        Paragraph(
            f"Period: <b>{escape(report['period'])}</b> &nbsp;&nbsp;|&nbsp;&nbsp; "
            f"Generated: {escape(report['generated_at'][:19].replace('T', ' '))} UTC",
            styles["Small"],
        )
    )
    story.append(Spacer(1, 6))

    banner_text = (
        "DEMONSTRATION DATA: every metric in this report is simulated. It is not a real cloud measurement."
        if report["simulated"]
        else "LIVE DATA: telemetry was collected from registered CloudPulse agents."
    )
    banner = Table([[Paragraph(escape(banner_text), styles["Banner"])]], colWidths=[174 * mm])
    banner.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FEF3C7") if report["simulated"] else colors.HexColor("#DCFCE7")),
                ("BOX", (0, 0), (-1, -1), 0.5, amber if report["simulated"] else colors.HexColor("#86EFAC")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(banner)
    story.append(Spacer(1, 10))

    summary = report["summary"]
    summary_cells = [
        ["Servers", "Avg CPU", "Avg memory", "Availability", "Open alerts", "Anomalies"],
        [
            str(summary["servers"]),
            _fmt(summary["avg_cpu"], 1, "%"),
            _fmt(summary["avg_memory"], 1, "%"),
            _fmt(summary["avg_availability"], 1, "%"),
            str(summary["active_alerts"]),
            str(summary["anomalies"]),
        ],
    ]
    summary_table = Table(summary_cells, colWidths=[29 * mm] * 6)
    summary_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), navy),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("BACKGROUND", (0, 1), (-1, 1), light),
                ("TEXTCOLOR", (0, 1), (-1, 1), navy),
                ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.4, line),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(summary_table)

    story.append(Paragraph("Infrastructure snapshot", styles["Section"]))
    server_rows = [["Server", "Type", "Status", "CPU", "Memory", "Disk", "Health", "Availability"]]
    for server in report["servers"][:20]:
        latest = server.get("latest_metrics") or {}
        server_rows.append(
            [
                str(server.get("name", "-"))[:22],
                str(server.get("resource_type", "-"))[:16],
                str(server.get("status", "-")).title(),
                _fmt(latest.get("cpu_percent"), 1, "%"),
                _fmt(latest.get("memory_percent"), 1, "%"),
                _fmt(latest.get("disk_percent"), 1, "%"),
                _fmt(server.get("health_score"), 0),
                _fmt(server.get("availability", 100), 1, "%"),
            ]
        )
    server_table = Table(server_rows, colWidths=[38 * mm, 24 * mm, 20 * mm, 16 * mm, 18 * mm, 16 * mm, 16 * mm, 24 * mm], repeatRows=1)
    server_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), blue),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("GRID", (0, 0), (-1, -1), 0.35, line),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, light]),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ALIGN", (3, 1), (-1, -1), "CENTER"),
            ]
        )
    )
    story.append(server_table)

    story.append(Paragraph("Alerts raised in this period", styles["Section"]))
    if report["alerts"]:
        alert_rows = [["Severity", "Server", "Category", "Status", "Raised (UTC)"]]
        for alert in report["alerts"][:15]:
            alert_rows.append(
                [
                    str(alert.get("severity", "-")).title(),
                    str(alert.get("server_name", "-"))[:22],
                    str(alert.get("category", "-")).replace("_", " ").title(),
                    str(alert.get("status", "-")).title(),
                    str(alert.get("created_at", ""))[:19].replace("T", " "),
                ]
            )
        alert_table = Table(alert_rows, colWidths=[24 * mm, 44 * mm, 34 * mm, 28 * mm, 44 * mm], repeatRows=1)
        alert_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), navy),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 7),
                    ("GRID", (0, 0), (-1, -1), 0.35, line),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, light]),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(alert_table)
    else:
        story.append(Paragraph("No alerts were raised during this period.", styles["Small"]))

    story.append(Paragraph("Anomaly summary", styles["Section"]))
    if report["anomalies"]:
        anomaly_rows = [["Server", "Metric", "Severity", "Score", "Detected (UTC)"]]
        for anomaly in report["anomalies"][:15]:
            anomaly_rows.append(
                [
                    str(anomaly.get("server_name", "-"))[:22],
                    str(anomaly.get("metric_label", anomaly.get("metric", "-")))[:26],
                    str(anomaly.get("severity", "-")).title(),
                    _fmt(anomaly.get("anomaly_score"), 2),
                    str(anomaly.get("timestamp", ""))[:19].replace("T", " "),
                ]
            )
        anomaly_table = Table(anomaly_rows, colWidths=[38 * mm, 50 * mm, 24 * mm, 22 * mm, 40 * mm], repeatRows=1)
        anomaly_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), cyan),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 7),
                    ("GRID", (0, 0), (-1, -1), 0.35, line),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, light]),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(anomaly_table)
    else:
        story.append(Paragraph("No anomalies were detected in this period.", styles["Small"]))

    story.append(Paragraph("Cost estimate", styles["Section"]))
    story.append(
        Paragraph(
            f"Estimated monthly run-rate: <b>${_fmt(report['costs']['monthly_estimated'], 2)}</b>. "
            "This is derived from configured per-hour resource costs and is not a cloud provider invoice.",
            styles["Small"],
        )
    )
    story.append(Spacer(1, 10))
    story.append(
        Paragraph(
            "Generated by CloudPulse. Availability figures use heartbeat observations from registered "
            "monitoring targets and are not an external uptime SLA.",
            ParagraphStyle("FootNote", parent=styles["Small"], textColor=muted, fontSize=7),
        )
    )

    def footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(line)
        canvas.line(18 * mm, 12 * mm, 192 * mm, 12 * mm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(muted)
        canvas.drawString(18 * mm, 8 * mm, "CloudPulse - Intelligent Cloud Infrastructure Monitoring & Analytics")
        canvas.drawRightString(192 * mm, 8 * mm, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def telemetry_csv(store, settings: dict, range_info: dict, *, server_id: str | None = None) -> str:
    source = data_source_for(settings)
    rows = load_rows(
        store,
        source=source,
        start_iso=range_info["start_iso"],
        end_iso=range_info["end_iso"],
        server_id=server_id,
        limit=50000,
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "timestamp", "server_id", "server_name", "data_source", "simulated",
            "cpu_percent", "memory_percent", "memory_available_mb", "disk_percent",
            "network_in_mbps", "network_out_mbps", "network_total_mbps",
            "response_time_ms", "uptime_seconds",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.get("timestamp"),
                row.get("server_id"),
                row.get("server_name"),
                row.get("data_source"),
                "yes" if row.get("simulated") else "no",
                row.get("cpu_percent"),
                row.get("memory_percent"),
                row.get("memory_available_mb"),
                row.get("disk_percent"),
                round(float(row.get("network_in_bps") or 0) / 1_000_000, 3),
                round(float(row.get("network_out_bps") or 0) / 1_000_000, 3),
                round(float(row.get("network_throughput_bps") or 0) / 1_000_000, 3),
                row.get("response_time_ms"),
                row.get("uptime_seconds"),
            ]
        )
    return buffer.getvalue()

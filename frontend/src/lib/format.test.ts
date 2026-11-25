import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  cn,
  formatChartTime,
  formatDateTime,
  formatInclusiveEnd,
  formatMbps,
  formatMoney,
  formatMs,
  formatPercent,
  formatUptime,
  healthColor,
  healthLabel,
  initials,
  rangeLabel,
  severityMeta,
  statusMeta,
  timeAgo,
  titleCase,
} from "./format";

describe("number and unit formatting", () => {
  it("formats percentages with one decimal by default", () => {
    expect(formatPercent(42.456)).toBe("42.5%");
    expect(formatPercent(42.456, 0)).toBe("42%");
    expect(formatPercent(null)).toBe("—");
  });

  it("formats throughput in Mbps and Gbps", () => {
    expect(formatMbps(12.345)).toBe("12.3 Mbps");
    expect(formatMbps(850)).toBe("850 Mbps");
    expect(formatMbps(1500)).toBe("1.50 Gbps");
    expect(formatMbps(undefined)).toBe("—");
  });

  it("formats latency, uptime and currency", () => {
    expect(formatMs(91.7)).toBe("92 ms");
    expect(formatUptime(90_061)).toBe("1d 1h");
    expect(formatUptime(3_900)).toBe("1h 5m");
    expect(formatUptime(120)).toBe("2m");
    expect(formatUptime(0)).toBe("—");
    expect(formatMoney(1234.5)).toBe("$1,235");
    expect(formatMoney(12.4)).toBe("$12.40");
  });
});

describe("status presentation", () => {
  it("maps every server status to a human label", () => {
    expect(statusMeta("healthy").label).toBe("Healthy");
    expect(statusMeta("warning").label).toBe("Warning");
    expect(statusMeta("critical").label).toBe("Critical");
    expect(statusMeta("offline").label).toBe("Offline");
    expect(statusMeta("mystery").label).toBe("Unknown");
  });

  it("maps alert lifecycle statuses without reusing severity labels", () => {
    expect(statusMeta("active").label).toBe("Active");
    expect(statusMeta("acknowledged").label).toBe("Acknowledged");
    expect(statusMeta("resolved").label).toBe("Resolved");
  });

  it("maps alert severity", () => {
    expect(severityMeta("critical").label).toBe("Critical");
    expect(severityMeta("warning").label).toBe("Warning");
    expect(severityMeta(undefined).label).toBe("Warning");
  });

  it("uses a consistent health scale", () => {
    expect(healthLabel(96)).toBe("Excellent");
    expect(healthLabel(80)).toBe("Healthy");
    expect(healthLabel(60)).toBe("Warning");
    expect(healthLabel(20)).toBe("Critical");
    expect(healthColor(96)).toBe("#34d399");
    expect(healthColor(80)).toBe("#22d3ee");
    expect(healthColor(60)).toBe("#fbbf24");
    expect(healthColor(20)).toBe("#fb7185");
  });
});

describe("date and text helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces relative times from ISO timestamps", () => {
    expect(timeAgo("2026-11-21T11:59:55Z")).toBe("just now");
    expect(timeAgo("2026-11-21T11:59:30Z")).toBe("30s ago");
    expect(timeAgo("2026-11-21T11:55:00Z")).toBe("5m ago");
    expect(timeAgo("2026-11-21T09:00:00Z")).toBe("3h ago");
    expect(timeAgo("2026-11-19T12:00:00Z")).toBe("2d ago");
    expect(timeAgo(null)).toBe("never");
    expect(timeAgo("not-a-date")).toBe("unknown");
  });

  it("produces stable date and time strings", () => {
    // Build timestamps in local time so assertions hold in any timezone.
    const localMorning = new Date(2026, 10, 21, 9, 30, 0);
    expect(formatDateTime(localMorning.toISOString())).toMatch(/Nov 21/);
    expect(formatChartTime(localMorning.toISOString(), "24h")).toMatch(/09:30/);
    expect(formatChartTime(localMorning.toISOString(), "7d")).toMatch(/Nov/);
    expect(formatChartTime("invalid", "7d")).toBe("");
  });

  it("renders an exclusive report end as the last included day", () => {
    const exclusiveEnd = new Date(2026, 10, 21, 0, 0, 0);
    expect(formatInclusiveEnd(exclusiveEnd.toISOString())).toMatch(/Nov 20, 2026/);
    expect(formatInclusiveEnd(null)).toBe("—");
  });

  it("handles labels, initials and class merging", () => {
    expect(titleCase("response_time_ms")).toBe("Response Time Ms");
    expect(titleCase("production")).toBe("Production");
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials(undefined)).toBe("CP");
    expect(rangeLabel("24h")).toBe("Last 24 hours");
    expect(rangeLabel("3w")).toBe("3w");
    expect(cn("a", false && "b", ["c", "d"])).toBe("a c d");
  });
});

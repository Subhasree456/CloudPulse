export type Role = "admin" | "viewer";
export type ServerStatus = "healthy" | "warning" | "critical" | "offline" | "unknown";
export type DataSource = "simulated" | "live";
export type Severity = "warning" | "critical";
export type AlertStatus = "active" | "acknowledged" | "resolved";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: string;
  last_login_at?: string;
}

export interface AuthResponse {
  token: string;
  expires_at: string;
  user: User;
}

export interface ThresholdPair {
  warning: number;
  critical: number;
}

export interface Thresholds {
  cpu: ThresholdPair;
  memory: ThresholdPair;
  disk: ThresholdPair;
  response_time_ms: ThresholdPair;
  network_mbps: ThresholdPair;
  [key: string]: ThresholdPair;
}

export interface MetricSnapshot {
  timestamp: string;
  cpu_percent: number;
  memory_percent: number;
  memory_available_mb?: number;
  memory_total_mb?: number;
  disk_percent: number;
  network_in_bps: number;
  network_out_bps: number;
  network_throughput_bps: number;
  response_time_ms: number;
  uptime_seconds: number;
  load_average?: number;
}

export interface Server {
  id: string;
  name: string;
  hostname: string;
  ip_address: string;
  os: string;
  resource_type: string;
  provider?: string;
  region?: string;
  environment?: string;
  description?: string;
  status: ServerStatus;
  health_score: number;
  data_source: DataSource;
  simulated: boolean;
  is_local?: boolean;
  agent_connected?: boolean;
  tags: string[];
  cost_per_hour: number;
  registered_at?: string;
  monitoring_since?: string;
  last_seen: string | null;
  latest_metrics: MetricSnapshot | null;
  thresholds?: Thresholds;
}

export interface TelemetryPoint extends MetricSnapshot {
  id: string;
  server_id: string;
  server_name: string;
  timestamp: string;
  data_source: DataSource;
  simulated: boolean;
  received_at?: string;
  load_average?: number;
}

export interface SeriesPoint {
  timestamp: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  response_time_ms: number;
  network_in_mbps: number;
  network_out_mbps: number;
  network_mbps: number;
  samples: number;
}

export interface Alert {
  id: string;
  server_id: string;
  server_name: string;
  category: "cpu" | "memory" | "disk" | "network" | "response_time" | "availability" | string;
  severity: Severity;
  title: string;
  description: string;
  recommended_action: string;
  metric_value: number | null;
  metric_unit: string;
  threshold: number | null;
  status: AlertStatus;
  data_source: DataSource;
  created_at: string;
  updated_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_reason?: string | null;
}

export interface AlertSummary {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
  critical: number;
  warning: number;
}

export interface ServerAlertSummary {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
  critical: number;
  warning: number;
}

export interface Anomaly {
  id: string;
  server_id: string;
  server_name: string;
  metric: string;
  metric_label: string;
  unit: string;
  value: number;
  expected: number;
  anomaly_score: number;
  zscore: number;
  severity: Severity;
  timestamp: string;
  data_source: DataSource;
  detection_method: string;
  detected_at: string;
}

export interface DetectionRun {
  id: string;
  status: "completed" | "insufficient_data" | "disabled" | "unavailable";
  data_source: DataSource;
  triggered_by: string;
  analyzed_servers: number;
  analyzed_points: number;
  anomalies_found: number;
  new_anomalies: number;
  skipped_servers: string[];
  run_at: string;
  message: string;
}

export interface Overview {
  mode: "demo" | "live";
  data_source: DataSource;
  generated_at: string;
  range: { label: string; start: string; end: string; seconds: number };
  metrics: {
    total_servers: number;
    active_servers: number;
    offline_servers: number;
    cpu_percent: number;
    memory_percent: number;
    disk_percent: number;
    network_mbps: number;
    response_time_ms: number;
    uptime_percent: number;
    active_alerts: number;
    anomalies_24h: number;
  };
  alert_summary: AlertSummary;
  health_distribution: { excellent: number; healthy: number; warning: number; critical: number };
  series: SeriesPoint[];
  servers: Server[];
  top_servers: Server[];
  recent_alerts: Alert[];
  costs: {
    monthly_estimated: number;
    by_type: { type: string; monthly: number }[];
  };
  notes: Record<string, string>;
}

export interface Comparison {
  id: string;
  name: string;
  resource_type: string;
  status: ServerStatus;
  health_score: number;
  availability: number;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  network_mbps: number;
  response_time_ms: number;
  samples: number;
}

export interface DailyPoint {
  date: string;
  cpu_percent: number;
  memory_percent: number;
  network_mbps: number;
  response_time_ms: number;
  samples: number;
}

export interface AnalyticsData {
  mode: "demo" | "live";
  data_source: DataSource;
  range: { label: string; start: string; end: string; seconds: number };
  generated_at: string;
  series: SeriesPoint[];
  daily: DailyPoint[];
  availability: { id: string; name: string; availability: number; status: ServerStatus }[];
  comparisons: Comparison[];
  top_consumers: Comparison[];
  totals: {
    samples: number;
    servers: number;
    alerts: number;
    anomalies: number;
    avg_cpu: number;
    avg_memory: number;
    avg_availability: number;
  };
  costs: {
    monthly_estimated: number;
    by_type: { type: string; monthly: number }[];
    note: string;
  };
  notes: Record<string, string>;
}

export interface MonitoringSettings {
  id: string;
  mode: "demo" | "live";
  monitoring_interval_seconds: number;
  offline_after_seconds: number;
  retention_days: number;
  anomaly_detection_enabled: boolean;
  auto_resolve_availability: boolean;
  thresholds: Thresholds;
  updated_at: string;
}

export interface SystemInfo {
  app: string;
  version: string;
  environment: string;
  database_backend: "sqlite" | "mongodb";
  database_detail: string;
  background_workers: boolean;
  local_collector_enabled: boolean;
  agent_enrollment_enabled: boolean;
  api_latency_ms: number;
  server_time: string;
}

export interface SettingsPayload {
  settings: MonitoringSettings;
  effective_offline_seconds: number;
  system: SystemInfo;
}

export interface ServiceItem {
  name: string;
  detail: string;
  status: string;
  kind: "actual" | "simulated" | "conceptual" | "fallback" | "configuration";
  verified: boolean;
}

export interface ServiceCategory {
  id: string;
  acronym: string;
  name: string;
  description: string;
  icon: string;
  status: string;
  items: ServiceItem[];
}

export interface ServicesPayload {
  generated_at: string;
  mode: "demo" | "live";
  data_source: DataSource;
  database: { backend: string; connected: boolean; detail: string };
  summary: {
    live_targets: number;
    demo_targets: number;
    enrolled_agents: number;
    integrated_services: number;
    conceptual_services: number;
  };
  categories: ServiceCategory[];
  disclaimer: string;
}

export interface ReportSummary {
  id: string;
  type: "daily" | "weekly";
  title: string;
  period: string;
  start: string;
  end: string;
  generated_at: string;
  mode: "demo" | "live";
  data_source: DataSource;
  simulated: boolean;
  summary: {
    servers: number;
    avg_cpu: number;
    avg_memory: number;
    avg_availability: number;
    active_alerts: number;
    alerts_total: number;
    anomalies: number;
    critical_anomalies: number;
    samples: number;
  };
  servers: (Server & { availability: number })[];
  alerts: Alert[];
  anomalies: Anomaly[];
  series: SeriesPoint[];
  daily: DailyPoint[];
  costs: { monthly_estimated: number; by_type: { type: string; monthly: number }[]; note: string };
  notes: Record<string, string>;
}

export interface ReportRecord {
  id: string;
  report_type: "daily" | "weekly";
  title: string;
  period: string;
  start: string;
  end: string;
  data_source: DataSource;
  format: string;
  summary: ReportSummary["summary"];
  created_by: string;
  created_at: string;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  version: string;
  environment: string;
  timestamp: string;
  uptime_seconds: number;
  mode: "demo" | "live" | "unknown";
  data_source: DataSource;
  database: { backend: string; connected: boolean; detail: string };
  workers: { running: boolean; last_error?: string | null };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ServerListResponse extends Paginated<Server> {
  status_counts: Record<string, number>;
  mode: "demo" | "live";
  data_source: DataSource | "all";
  types: string[];
}

export interface AlertsResponse extends Paginated<Alert> {
  summary: AlertSummary;
  data_source: DataSource | "all";
}

export interface AnomaliesResponse {
  items: Anomaly[];
  summary: { total: number; critical: number; warning: number; servers: number };
  latest_run: DetectionRun | null;
  runs: DetectionRun[];
  servers: { id: string; name: string }[];
  data_source: DataSource | "all";
  range: { label: string; start: string; end: string };
  minimum_points: number;
  message: string;
}

export interface RecentEvent {
  server_id: string;
  server_name: string;
  data_source: DataSource;
  simulated: boolean;
  timestamp: string;
  status: ServerStatus;
  health_score: number;
  metrics: {
    cpu_percent: number;
    memory_percent: number;
    disk_percent: number;
    network_in_mbps: number;
    network_out_mbps: number;
    network_mbps: number;
    response_time_ms: number;
    uptime_seconds: number;
  };
}

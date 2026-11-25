import { useId, useMemo, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn, CHART, chartTooltipStyle, formatChartTime } from "../lib/format";

/* -------------------------------------------------------------------------- */
/* Shared tooltip                                                              */
/* -------------------------------------------------------------------------- */
interface TooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

function TooltipCard({
  active,
  payload,
  label,
  suffixMap,
  range,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  suffixMap?: Record<string, string>;
  range?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={chartTooltipStyle}>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {typeof label === "string" ? formatChartTime(label, range) : String(label ?? "")}
      </p>
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div key={`${entry.dataKey}-${index}`} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color }} />
              {entry.name}
            </span>
            <span className="font-mono text-[11px] font-medium text-white">
              {typeof entry.value === "number" ? entry.value.toFixed(1) : entry.value}
              {suffixMap?.[String(entry.dataKey)] ?? ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sparkline (lightweight inline SVG)                                          */
/* -------------------------------------------------------------------------- */
export function Sparkline({
  data,
  color = CHART.accent,
  className,
  height = 40,
  fill = true,
}: {
  data: number[];
  color?: string;
  className?: string;
  height?: number;
  fill?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const width = 120;
  const values = data.filter((value) => Number.isFinite(value));
  if (values.length < 2) {
    return <div className={cn("h-10 w-full", className)} aria-hidden="true" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 4 - ((value - min) / spread) * (height - 8);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const linePath = `M${points.join(" L")}`;
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={areaPath} fill={`url(#spark-${id})`} />}
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Chart card                                                                  */
/* -------------------------------------------------------------------------- */
export function ChartCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  footnote,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footnote?: string;
}) {
  return (
    <section className={cn("card flex flex-col", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pb-3 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </header>
      <div className={cn("min-h-0 flex-1 px-2 pb-3 sm:px-3", bodyClassName)}>{children}</div>
      {footnote && (
        <p className="border-t border-line/10 px-4 py-2 text-[9px] leading-relaxed text-muted/70 sm:px-5">{footnote}</p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Area trend                                                                  */
/* -------------------------------------------------------------------------- */
export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  suffix?: string;
  unit?: "percent" | "number" | "ms" | "mbps";
}

export function TrendChart({
  data,
  series,
  height = 260,
  range,
  xKey = "timestamp",
  yDomain,
}: {
  data: object[];
  series: TrendSeries[];
  height?: number;
  range?: string;
  xKey?: string;
  yDomain?: [number | "auto", number | "auto"];
}) {
  const suffixMap = useMemo(
    () => Object.fromEntries(series.map((item) => [item.key, item.suffix ?? (item.unit === "percent" ? "%" : "")])),
    [series],
  );

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <defs>
            {series.map((item) => (
              <linearGradient key={item.key} id={`grad-${item.key.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={item.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={item.color} stopOpacity={0.01} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="2 6" stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey={xKey}
            tickFormatter={(value: string) => formatChartTime(value, range)}
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={48}
            domain={yDomain ?? ["auto", "auto"]}
          />
          <Tooltip
            content={(props) => (
              <TooltipCard
                active={props.active}
                payload={props.payload as TooltipEntry[] | undefined}
                label={props.label as string | number | undefined}
                suffixMap={suffixMap}
                range={range}
              />
            )}
          />
          {series.map((item) => (
            <Area
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={1.9}
              fill={`url(#grad-${item.key.replace(/[^a-z0-9]/gi, "")})`}
              activeDot={{ r: 3, strokeWidth: 0, fill: item.color }}
              connectNulls
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Multi-line comparison                                                       */
/* -------------------------------------------------------------------------- */
export function ComparisonLineChart({
  data,
  series,
  height = 280,
  range,
}: {
  data: object[];
  series: TrendSeries[];
  height?: number;
  range?: string;
}) {
  const suffixMap = Object.fromEntries(series.map((item) => [item.key, item.suffix ?? ""]));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 14, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 6" stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(value: string) => formatChartTime(value, range)}
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis tick={{ fill: CHART.axis, fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            content={(props) => (
              <TooltipCard
                active={props.active}
                payload={props.payload as TooltipEntry[] | undefined}
                label={props.label as string | number | undefined}
                suffixMap={suffixMap}
                range={range}
              />
            )}
          />
          <Legend iconType="circle" iconSize={6} wrapperStyle={{ paddingTop: 8 }} />
          {series.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={1.9}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bars                                                                        */
/* -------------------------------------------------------------------------- */
export function BarsChart({
  data,
  xKey,
  series,
  height = 240,
  horizontal = false,
  stacked = false,
}: {
  data: object[];
  xKey: string;
  series: { key: string; label: string; color: string }[];
  height?: number;
  horizontal?: boolean;
  stacked?: boolean;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 16, left: horizontal ? 10 : -18, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="2 6" stroke={CHART.grid} vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fill: CHART.axis, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey={xKey}
                tick={{ fill: CHART.axis, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={108}
              />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={{ fill: CHART.axis, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: CHART.axis, fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
            </>
          )}
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.06)" }}
            content={(props) => (
              <TooltipCard
                active={props.active}
                payload={props.payload as TooltipEntry[] | undefined}
                label={props.label as string | number | undefined}
              />
            )}
          />
          {series.map((item) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.label}
              fill={item.color}
              radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              stackId={stacked ? "stack" : undefined}
              maxBarSize={horizontal ? 16 : 28}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Donut                                                                       */
/* -------------------------------------------------------------------------- */
export function DonutChart({
  data,
  height = 190,
  centerLabel,
  centerValue,
  innerRadius = 54,
  outerRadius = 74,
}: {
  data: { name: string; value: number; color: string }[];
  height?: number;
  centerLabel?: string;
  centerValue?: string | number;
  innerRadius?: number;
  outerRadius?: number;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="relative w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            stroke="none"
            startAngle={90}
            endAngle={-270}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            content={(props) => (
              <TooltipCard
                active={props.active}
                payload={props.payload as TooltipEntry[] | undefined}
                label={props.label as string | number | undefined}
              />
            )}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tracking-tight text-ink">{centerValue ?? total}</span>
        {centerLabel && <span className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-muted">{centerLabel}</span>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Radial gauge                                                                */
/* -------------------------------------------------------------------------- */
export function RadialGauge({
  value,
  size = 132,
  stroke = 8,
  color = CHART.emerald,
  label,
  sublabel,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  sublabel?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const dash = (clamped / 100) * circumference * 0.75;
  const track = circumference * 0.75;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-[135deg]">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(148,163,184,0.12)"
          strokeWidth={stroke}
          strokeDasharray={`${track} ${circumference}`}
          strokeLinecap="round"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color}55)`, transition: "stroke-dasharray 0.8s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tracking-[-0.04em] text-ink">{Math.round(clamped)}</span>
        {label && <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted">{label}</span>}
        {sublabel && <span className="mt-0.5 text-[9px] text-muted/70">{sublabel}</span>}
      </div>
    </div>
  );
}

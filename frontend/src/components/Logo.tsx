import { cn } from "../lib/format";

export function LogoMark({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-[11px] border border-accent/25 bg-canvas/80 shadow-[0_0_22px_rgba(34,211,238,0.18)]",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-accent/20 via-transparent to-info/15" />
      <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 32 32" fill="none">
        <path
          d="M3 17h6.2l3.1-8.2 5.3 16 3.1-8.6H29"
          stroke="currentColor"
          className="text-accent"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="29" cy="16.2" r="1.7" fill="currentColor" className="text-accent" />
      </svg>
    </div>
  );
}

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={compact ? 34 : 38} />
      {!compact && (
        <div className="min-w-0 leading-none">
          <p className="text-[17px] font-semibold tracking-[-0.03em] text-ink">
            Cloud<span className="text-accent">Pulse</span>
          </p>
          <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.22em] text-muted/80">
            Monitor · Analyse · Optimise
          </p>
        </div>
      )}
    </div>
  );
}

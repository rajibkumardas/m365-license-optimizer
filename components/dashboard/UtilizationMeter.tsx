/** Assigned vs purchased meter. Idle share is drawn in the status "serious" color with a label, never color alone. */
export function UtilizationMeter({ assigned, purchased, free }: { assigned: number; purchased: number; free?: boolean }) {
  const ratio = purchased > 0 ? Math.min(1, assigned / purchased) : 0;
  const idle = 1 - ratio;
  const flag = !free && idle >= 0.15;
  return (
    <div className="flex min-w-[140px] items-center gap-2">
      <div className="flex h-2 flex-1 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${Math.round(ratio * 100)}% assigned`}>
        <div className="h-full rounded-l-full bg-accent" style={{ width: `${ratio * 100}%` }} />
        <div
          className={`h-full flex-1 rounded-r-full ${flag ? "bg-serious" : "bg-surface-2"}`}
          style={{ minWidth: idle > 0 ? 2 : 0 }}
        />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-ink-2">{free ? "n/a" : `${Math.round(ratio * 100)}%`}</span>
    </div>
  );
}

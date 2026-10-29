import { AlertTriangle } from "lucide-react";

export function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mb-6 space-y-2">
      {items.map((w) => (
        <div key={w} className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-label="Warning" />
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
}

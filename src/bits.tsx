import type { Stage } from "./types";
import { STAGE_TONE } from "./types";

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`badge tone-${STAGE_TONE[stage]}`}>{stage}</span>;
}

export function ServiceChips({ services }: { services: string[] }) {
  if (!services.length) return <span className="cell-muted">—</span>;
  return (
    <span className="chips">
      {services.map((s) => (
        <span className="chip" key={s}>
          {s}
        </span>
      ))}
    </span>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

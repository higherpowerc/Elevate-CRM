import type { Stage } from "./types";
import { stageTone } from "./types";

/** Stage badge; tone follows the stage's position in the tenant's stage list
 *  (index 0 = gray, cycling through the palette) because stage names are
 *  tenant-defined. */
export function StageBadge({ stage, index = 0 }: { stage: Stage; index?: number }) {
  return <span className={`badge tone-${stageTone(index)}`}>{stage}</span>;
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

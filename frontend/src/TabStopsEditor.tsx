import { Plus, X } from "lucide-react";
import type { TabStop } from "./tabStops";

export default function TabStopsEditor({
  value,
  onChange,
}: {
  value: TabStop[] | null;
  onChange: (stops: TabStop[] | null) => void;
}) {
  const stops = value || [];
  const update = (i: number, changes: Partial<TabStop>) => {
    const result = stops.map((stop, n) =>
      n === i ? { ...stop, ...changes } : stop,
    );
    if (new Set(result.map((s) => s.position)).size !== result.length) return;
    onChange(result.sort((a, b) => a.position - b.position));
  };
  return (
    <fieldset className="tab-stop-editor">
      <legend>Tab stops</legend>
      <div className="tab-stop-actions">
        <span>
          {value == null
            ? "Inherited / mixed"
            : stops.length
              ? "Positions in points"
              : "Default: every 36 pt"}
        </span>
        <button type="button" onClick={() => onChange(null)}>
          Inherit
        </button>
        <button type="button" onClick={() => onChange([])}>
          Clear
        </button>
        <button
          type="button"
          aria-label="Add tab stop"
          disabled={stops.length >= 64 || (stops.at(-1)?.position || 0) >= 1440}
          onClick={() =>
            onChange([
              ...stops,
              {
                position: Math.min(1440, (stops.at(-1)?.position || 0) + 72),
                align: "left",
                leader: "none",
              },
            ])
          }
        >
          <Plus size={16} />
        </button>
      </div>
      {stops.map((stop, i) => (
        <div className="tab-stop-row" key={i}>
          <label>
            Position (pt)
            <input
              aria-label={`Tab ${i + 1} position (pt)`}
              type="number"
              min={0.5}
              max={1440}
              step={0.5}
              value={stop.position}
              onChange={(e) => {
                if (e.target.validity.valid && e.target.value)
                  update(i, { position: Number(e.target.value) });
              }}
            />
          </label>
          <label>
            Alignment
            <select
              aria-label={`Tab ${i + 1} alignment`}
              value={stop.align}
              onChange={(e) =>
                update(i, { align: e.target.value as TabStop["align"] })
              }
            >
              {["left", "center", "right", "decimal"].map((a) => (
                <option key={a} value={a}>
                  {a === "center" ? "Centre" : a[0].toUpperCase() + a.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Leader
            <select
              aria-label={`Tab ${i + 1} leader`}
              value={stop.leader}
              onChange={(e) =>
                update(i, { leader: e.target.value as TabStop["leader"] })
              }
            >
              {["none", "dot", "dash", "line"].map((a) => (
                <option key={a} value={a}>
                  {a[0].toUpperCase() + a.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label={`Remove tab ${i + 1}`}
            onClick={() => onChange(stops.filter((_, n) => n !== i))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </fieldset>
  );
}

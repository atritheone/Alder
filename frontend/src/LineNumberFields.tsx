import {
  defaultLineNumbering,
  validLineNumbering,
  type LineNumbering,
} from "./lineNumbering";
export default function LineNumberFields({
  value,
  onChange,
  rowClass,
}: {
  value?: LineNumbering | null;
  onChange: (value: LineNumbering | null) => void;
  rowClass?: string;
}) {
  const change = (patch: Partial<LineNumbering>) => {
    const next = { ...defaultLineNumbering, ...value, ...patch };
    if (validLineNumbering(next)) onChange(next);
  };
  return (
    <>
      <label className={rowClass}>
        Line numbering
        <select
          aria-label="Line numbering"
          value={value?.restart || "none"}
          onChange={(e) =>
            e.target.value === "none"
              ? onChange(null)
              : change({ restart: e.target.value as LineNumbering["restart"] })
          }
        >
          <option value="none">None</option>
          <option value="newPage">Restart each page</option>
          <option value="newSection">Restart each section</option>
          <option value="continuous">Continuous</option>
        </select>
      </label>
      {value && (
        <>
          <label className={rowClass}>
            Start at
            <input
              aria-label="Line numbering start"
              type="number"
              min={1}
              max={32767}
              value={value.start}
              onChange={(e) => change({ start: Number(e.target.value) })}
            />
          </label>
          <label className={rowClass}>
            Show every
            <input
              aria-label="Line numbering interval"
              type="number"
              min={1}
              max={1000}
              value={value.step}
              onChange={(e) => change({ step: Number(e.target.value) })}
            />
          </label>
          <label className={rowClass}>
            Distance from text (pt)
            <input
              aria-label="Line numbering distance (pt)"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={value.distance}
              onChange={(e) => change({ distance: Number(e.target.value) })}
            />
          </label>
        </>
      )}
    </>
  );
}

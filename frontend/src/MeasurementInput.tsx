import { useEffect, useState } from "react";
import { layoutUnits, parseMeasurement, useLayoutUnit } from "./layoutUnits";

/** Unit changes never round-trip rounded display values into the document. */
export default function MeasurementInput({
  value,
  onChange,
  label,
  min = -144,
  max = 1440,
  nullable = false,
  placeholder,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  min?: number;
  max?: number;
  nullable?: boolean;
  placeholder?: string;
}) {
  const [unit] = useLayoutUnit();
  const display = () =>
    value == null ? "" : String(Number((value / layoutUnits[unit]).toFixed(4)));
  const [text, setText] = useState(display);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(display());
  }, [value, unit, editing]);
  const parsed = parseMeasurement(text, unit);
  const valid =
    (nullable && !text.trim()) ||
    (parsed != null && parsed >= min && parsed <= max);
  return (
    <input
      aria-label={`${label} (${unit})`}
      value={text}
      inputMode="decimal"
      placeholder={placeholder ?? (nullable ? "Inherited / mixed" : undefined)}
      aria-invalid={!valid || undefined}
      onFocus={() => setEditing(true)}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const points = parseMeasurement(next, unit);
        if (nullable && !next.trim()) onChange(null);
        else if (points != null && points >= min && points <= max)
          onChange(points);
      }}
      onBlur={() => {
        setEditing(false);
        setText(display());
      }}
    />
  );
}

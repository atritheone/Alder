import { useEffect, useState } from "react";

export default function PlaybackSpeed({
  value,
  onChange,
  label = "Reading speed",
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      aria-label={label}
      title="Playback speed · type an exact multiplier (0.250–3.000×)"
      type="number"
      min="0.25"
      max="3"
      step="0.001"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = e.target.valueAsNumber;
        if (Number.isFinite(next) && next >= 0.25 && next <= 3) onChange(next);
      }}
      onBlur={() => {
        const next = text.trim() ? Number(text) : value;
        const valid = Number.isFinite(next)
          ? Math.max(0.25, Math.min(3, next))
          : value;
        onChange(valid);
        setText(String(valid));
      }}
    />
  );
}

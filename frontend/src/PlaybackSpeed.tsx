import { useEffect, useId, useState } from "react";

export default function PlaybackSpeed({
  value,
  onChange,
  label = "Reading speed",
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  const ticks = useId();
  const [text, setText] = useState(value.toFixed(2));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value.toFixed(2));
  }, [value, editing]);
  const commit = () => {
    const next = text.trim() ? Number(text) : value;
    const valid = Number.isFinite(next)
      ? Number(Math.max(0.25, Math.min(3, next)).toFixed(2))
      : value;
    onChange(valid);
    setText(valid.toFixed(2));
  };
  return (
    <span
      className="playback-speed"
      data-help="Adjust reading speed from 0.25× to 3.00× in 0.01 steps. Drag the slider, use its arrow keys, or type a multiplier to two decimal places. 1.00× is the original speed."
    >
      <input
        aria-label={`${label} slider`}
        title="Adjust speed in 0.01 steps"
        type="range"
        min="0.25"
        max="3"
        step="0.01"
        list={ticks}
        value={value}
        aria-valuetext={`${value.toFixed(2)} times normal speed`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <datalist id={ticks}>
        {Array.from({ length: 56 }, (_, i) => (0.25 + i * 0.05).toFixed(2)).map(
          (tick) => (
            <option key={tick} value={tick} />
          ),
        )}
      </datalist>
      <input
        aria-label={label}
        title="Type an exact speed (0.25–3.00×), to two decimal places"
        type="number"
        min="0.25"
        max="3"
        step="0.01"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setText(e.target.value);
          const next = e.target.valueAsNumber;
          if (Number.isFinite(next) && next >= 0.25 && next <= 3)
            onChange(Number(next.toFixed(2)));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          commit();
          setEditing(false);
        }}
      />
    </span>
  );
}

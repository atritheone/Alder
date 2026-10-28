import { useEffect, useRef, useState } from "react";

export default function FontSizeField({
  value,
  onApply,
}: {
  value: string;
  onApply: (size: number) => void;
}) {
  const [text, setText] = useState(value);
  const skipBlur = useRef(false);
  useEffect(() => setText(value), [value]);
  const apply = () => {
    const size = Number(text);
    if (text.trim() && Number.isFinite(size) && size >= 6 && size <= 72) {
      if (text !== value) onApply(size);
    } else setText(value);
  };
  return (
    <input
      className="font-size-input"
      aria-label="Font size"
      title="Font size (6–72 pt)"
      inputMode="decimal"
      value={text}
      placeholder="Mixed"
      onChange={(e) => setText(e.target.value)}
      onFocus={() => {
        skipBlur.current = false;
      }}
      onBlur={() => {
        if (!skipBlur.current) apply();
        skipBlur.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          skipBlur.current = true;
          apply();
          skipBlur.current = false;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          skipBlur.current = true;
          setText(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

import { useRef } from "react";

type Props = {
  label: string;
  orientation: "horizontal" | "vertical";
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

export default function ResizeHandle({
  label,
  orientation,
  value,
  min,
  max,
  onChange,
}: Props) {
  const drag = useRef<{ start: number; value: number; scale: number } | null>(
    null,
  );
  const vertical = orientation === "vertical";
  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return (
    <div
      className={`library-resizer ${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-help={`${label}. Drag this divider or use the arrow keys to adjust the adjacent panels.`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const parent = e.currentTarget.parentElement!;
        const box = parent.getBoundingClientRect();
        drag.current = {
          start: vertical ? e.clientX : e.clientY,
          value,
          scale: vertical
            ? box.width / parent.offsetWidth
            : box.height / parent.offsetHeight,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current)
          update(
            drag.current.value +
              ((vertical ? e.clientX : e.clientY) - drag.current.start) /
                drag.current.scale,
          );
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        const keys = vertical
          ? ["ArrowLeft", "ArrowRight"]
          : ["ArrowUp", "ArrowDown"];
        if (keys.includes(e.key)) {
          e.preventDefault();
          update(value + (e.key === keys[0] ? -10 : 10));
        }
      }}
    />
  );
}

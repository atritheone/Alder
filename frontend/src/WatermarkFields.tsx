import { useEffect, useState } from "react";
import {
  defaultWatermark,
  naturalWatermarkHeight,
  validWatermark,
  type Watermark,
} from "./watermark";
export default function WatermarkFields({
  value,
  onChange,
  rowClass,
}: {
  value?: Watermark | null;
  onChange: (value: Watermark | null) => void;
  rowClass?: string;
}) {
  const [text, setText] = useState(value?.text || "");
  useEffect(() => setText(value?.text || ""), [value?.text]);
  const change = (patch: Partial<Watermark>) => {
    const next = { ...defaultWatermark, ...value, ...patch };
    if (patch.text != null || patch.fontFamily != null)
      next.heightMm = naturalWatermarkHeight(
        next.text,
        next.fontFamily,
        next.widthMm,
      );
    else if (patch.widthMm != null && value)
      next.heightMm =
        Math.round(
          Math.max(
            1,
            Math.min(1000, (value.heightMm * patch.widthMm) / value.widthMm),
          ) * 100,
        ) / 100;
    if (validWatermark(next)) onChange(next);
  };
  const commit = () => {
    if (text.trim()) change({ text });
    else setText(value?.text || "");
  };
  return (
    <>
      <label className={rowClass}>
        Watermark
        <select
          aria-label="Watermark"
          value={value ? "text" : "none"}
          onChange={(e) =>
            e.target.value === "none"
              ? onChange(null)
              : onChange(defaultWatermark)
          }
        >
          <option value="none">None</option>
          <option value="text">Text</option>
        </select>
      </label>
      {value && (
        <>
          <label className={rowClass}>
            Text
            <input
              aria-label="Watermark text"
              maxLength={120}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
              }}
            />
          </label>
          <label className={rowClass}>
            Font
            <input
              aria-label="Watermark font"
              value={value.fontFamily}
              onChange={(e) => change({ fontFamily: e.target.value })}
            />
          </label>
          <label className={rowClass}>
            Colour
            <input
              aria-label="Watermark colour"
              type="color"
              value={value.color}
              onChange={(e) => change({ color: e.target.value })}
            />
          </label>
          <label className={rowClass}>
            Width (mm)
            <input
              aria-label="Watermark width (mm)"
              type="number"
              min={1}
              max={1000}
              value={value.widthMm}
              onChange={(e) => change({ widthMm: Number(e.target.value) })}
            />
          </label>
          <label className={rowClass}>
            Height (mm)
            <input
              aria-label="Watermark height (mm)"
              type="number"
              min={1}
              max={1000}
              value={value.heightMm}
              onChange={(e) => change({ heightMm: Number(e.target.value) })}
            />
          </label>
          <label className={rowClass}>
            Angle (°)
            <input
              aria-label="Watermark angle (degrees)"
              type="number"
              min={0}
              max={359}
              value={value.angle}
              onChange={(e) => change({ angle: Number(e.target.value) })}
            />
          </label>
        </>
      )}
    </>
  );
}

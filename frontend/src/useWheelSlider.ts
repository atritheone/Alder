import { useEffect, useState } from "react";

// A non-passive listener consumes wheel movement on the slider itself, so the
// document does not scroll underneath a control while its value changes.
export function useWheelSlider(
  value: number,
  onChange: (value: number) => void,
  min: number,
  max: number,
  step: number,
) {
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!input) return;
    let current = value;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY || event.ctrlKey || input.disabled) return;
      event.preventDefault();
      current = Number(
        Math.max(
          min,
          Math.min(max, current - Math.sign(event.deltaY) * step),
        ).toFixed(2),
      );
      onChange(current);
    };
    input.addEventListener("wheel", wheel, { passive: false });
    return () => input.removeEventListener("wheel", wheel);
  }, [input, value, onChange, min, max, step]);
  return setInput;
}

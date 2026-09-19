import { useEffect, useState } from "react";

function savedLevel(key: string, fallback: number, min: number, max: number) {
  const raw = localStorage.getItem(key);
  const value = raw === null || !raw.trim() ? fallback : Number(raw);
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

/** App-wide preferences in the persistent renderer profile on every desktop OS. */
export function usePlaybackSettings(
  scope: "reading" | "narration" | "sandbox",
) {
  const [speed, setSpeed] = useState(() =>
    savedLevel(`alder.${scope}Speed`, 1, 0.25, 3),
  );
  const [volume, setVolume] = useState(() =>
    savedLevel(`alder.${scope}Volume`, 2, 0, 4),
  );
  useEffect(() => {
    localStorage.setItem(`alder.${scope}Speed`, String(speed));
    localStorage.setItem(`alder.${scope}Volume`, String(volume));
  }, [scope, speed, volume]);
  return { speed, setSpeed, volume, setVolume };
}

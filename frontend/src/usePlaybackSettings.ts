import { useCallback } from "react";
import { useStoredPreference } from "./useStoredPreference";

function level(raw: string, fallback: number, min: number, max: number) {
  const value = raw.trim() ? Number(raw) : fallback;
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

/** App-wide preferences in the persistent renderer profile on every desktop OS. */
export function usePlaybackSettings(
  scope: "reading" | "narration" | "sandbox",
) {
  const [speed, saveSpeed] = useStoredPreference(`alder.${scope}Speed`, "1");
  const [volume, saveVolume] = useStoredPreference(`alder.${scope}Volume`, "2");
  const setSpeed = useCallback(
    (value: number) => saveSpeed(String(level(String(value), 1, 0.25, 3))),
    [saveSpeed],
  );
  const setVolume = useCallback(
    (value: number) => saveVolume(String(level(String(value), 2, 0, 4))),
    [saveVolume],
  );
  return {
    speed: level(speed, 1, 0.25, 3),
    setSpeed,
    volume: level(volume, 2, 0, 4),
    setVolume,
  };
}

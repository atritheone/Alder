import defaults from "../../backend/alder/document-format.json";
import type { StyleProperties } from "./types";

/** Shared publication/editor defaults, in points (never screen pixels). */
export function headingFormatting(level: number): StyleProperties {
  return {
    ...defaults.heading,
    fontSize: defaults.headingSizes[Math.max(0, Math.min(5, level - 1))],
  };
}

export function editorFontPoints(pixels?: number): number {
  return ((pixels || 16) * 72) / 96;
}

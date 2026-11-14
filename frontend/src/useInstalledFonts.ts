import { useEffect, useState } from "react";
import { api } from "./api";
import {
  DOCUMENT_FONT,
  FALLBACK_FONT,
  fontIsAvailable,
  loadDocumentFont,
  restoreInstalledFonts,
  type FontCatalogue,
} from "./fontCatalogue";

const fallback = [DOCUMENT_FONT];
let cached: FontCatalogue | null = null;
let pending: Promise<FontCatalogue> | null = null;
function readFonts(refresh = false) {
  if (cached && !refresh) return Promise.resolve(cached);
  if (!pending)
    pending = api<FontCatalogue>("/api/fonts")
      .then((catalogue) => {
        restoreInstalledFonts(catalogue);
        return (cached = catalogue);
      })
      .finally(() => {
        pending = null;
      });
  return pending;
}

export function useFontCatalogue(current?: string | null) {
  const [catalogue, setCatalogue] = useState<FontCatalogue | null>(cached);
  useEffect(() => {
    let alive = true;
    const refresh = (force = false) => {
      void readFonts(force)
        .then((next) => {
          if (alive) setCatalogue(next);
        })
        .catch(() => {});
    };
    refresh();
    const focused = () => refresh(true);
    window.addEventListener("focus", focused);
    return () => {
      alive = false;
      window.removeEventListener("focus", focused);
    };
  }, []);
  const missing = Boolean(
    current && catalogue && !fontIsAvailable(current, catalogue),
  );
  useEffect(() => {
    if (!catalogue) return;
    if (missing || current === FALLBACK_FONT) void loadDocumentFont().catch(() => {});
    if (missing && current) void loadDocumentFont(current).catch(() => {});
  }, [current, missing, catalogue]);
  return {
    families: [
      ...new Set([
        current || DOCUMENT_FONT,
        ...(catalogue?.families || fallback),
      ]),
    ].sort((a, b) => a.localeCompare(b)),
    missing,
    catalogue,
    ready: catalogue !== null,
    fallback: catalogue?.fallback || FALLBACK_FONT,
  };
}
export function useInstalledFonts(current?: string | null) {
  return useFontCatalogue(current).families;
}

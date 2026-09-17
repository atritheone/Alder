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
function readFonts() {
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
    const refresh = () => {
      void readFonts()
        .then((next) => {
          if (alive) setCatalogue(next);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const missing = Boolean(
    current && catalogue && !fontIsAvailable(current, catalogue),
  );
  useEffect(() => {
    void loadDocumentFont().catch(() => {});
    if (missing && current) void loadDocumentFont(current).catch(() => {});
  }, [current, missing]);
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

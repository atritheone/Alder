import { useEffect, useState } from "react";
import { api } from "./api";

const fallback = ["Cambria", "Aptos", "Segoe UI", "Arial", "Times New Roman"];
let cached: string[] | null = null;
let pending: Promise<string[]> | null = null;
function readFonts() {
  if (!pending)
    pending = api<{ families: string[] }>("/api/fonts")
      .then(({ families }) => (cached = families))
      .finally(() => {
        pending = null;
      });
  return pending;
}

export function useInstalledFonts(current?: string | null) {
  const [fonts, setFonts] = useState(cached || fallback);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void readFonts()
        .then((next) => {
          if (alive) setFonts(next);
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
  return [...new Set([current || "Cambria", ...fonts])].sort((a, b) =>
    a.localeCompare(b),
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "./types";
import { api } from "./api";
import { migrateBook } from "./book";
export function useProject() {
  const [project, setProject] = useState<Project | null>(null),
    [saveState, setSaveState] = useState("Opening project…"),
    [error, setError] = useState("");
  const current = useRef<Project | null>(null),
    revision = useRef(0),
    dirty = useRef(false),
    serial = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    flight = useRef<Promise<void> | null>(null);
  const load = useCallback((p: Project) => {
    let converted = !p.book;
    p = migrateBook(p);
    // Replace Alder's previous default, preserving deliberately chosen fonts.
    if (p.settings.fontFamily === "Sitka Text") {
      p = structuredClone(p);
      p.settings.fontFamily = "Cambria";
      for (const style of p.styles)
        if (
          ["Body", "Heading"].includes(style.name) &&
          style.fontFamily === "Sitka Text"
        )
          style.fontFamily = "Cambria";
      converted = true;
    }
    current.current = p;
    revision.current = p.revision;
    dirty.current = converted;
    serial.current++;
    setProject(p);
    setSaveState("All changes saved");
    localStorage.setItem("alder.project", p.id);
  }, []);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (flight.current) {
      await flight.current;
      return;
    }
    const task = (async () => {
      while (dirty.current && current.current) {
        dirty.current = false;
        const snapshot = structuredClone(current.current),
          seq = serial.current;
        setSaveState("Saving…");
        try {
          const saved = await api<Project>(
            `/api/projects/${snapshot.id}`,
            "PUT",
            { expectedRevision: revision.current, project: snapshot },
          );
          revision.current = saved.revision;
          if (seq === serial.current) {
            current.current = saved;
            setProject(saved);
          } else if (current.current) {
            current.current = { ...current.current, revision: saved.revision };
          }
          setSaveState(dirty.current ? "Saving…" : "All changes saved");
        } catch (e) {
          dirty.current = true;
          setSaveState("Changes need saving");
          setError(String((e as Error).message));
          throw e;
        }
      }
    })();
    flight.current = task;
    try {
      await task;
    } finally {
      flight.current = null;
    }
  }, []);
  const change = useCallback(
    (mutate: (draft: Project) => void) => {
      if (!current.current) return;
      const next = structuredClone(current.current);
      mutate(next);
      current.current = next;
      serial.current++;
      dirty.current = true;
      setProject(next);
      setSaveState("Unsaved changes");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush().catch(() => {}), 500);
    },
    [flush],
  );
  useEffect(() => {
    if (project && dirty.current) void flush().catch(() => {});
  }, [project?.id, flush]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current || flight.current) {
        e.preventDefault();
        e.returnValue = "";
        void flush().catch(() => {});
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [flush]);
  const history = async (action: "undo" | "redo") => {
    await flush();
    if (current.current)
      load(
        await api<Project>(
          `/api/projects/${current.current.id}/${action}`,
          "POST",
        ),
      );
  };
  return { project, change, load, flush, saveState, error, setError, history };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "./types";
import { api } from "./api";
import { migrateBook } from "./book";
import { forgetSessionPosition, documentPositionKey } from "./documentPosition";
export function useProject() {
  const [project, setProject] = useState<Project | null>(null),
    [saveState, setSaveState] = useState("Opening project…"),
    [error, setError] = useState("");
  const [documents, setDocuments] = useState<{ id: string; name: string }[]>(
    [],
  );
  const opened = useRef(new Map<string, Project>());
  const transitions = useRef(Promise.resolve());
  const remember = useCallback((p: Project) => {
    opened.current.set(p.id, p);
    setDocuments((previous) => {
      const existing = previous.find((item) => item.id === p.id);
      if (existing?.name === p.name) return previous;
      return existing
        ? previous.map((item) =>
            item.id === p.id ? { id: p.id, name: p.name } : item,
          )
        : [...previous, { id: p.id, name: p.name }];
    });
  }, []);
  const current = useRef<Project | null>(null),
    revision = useRef(0),
    dirty = useRef(false),
    serial = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    flight = useRef<Promise<void> | null>(null);
  const install = useCallback(
    (p: Project) => {
      window.dispatchEvent(new Event("alder-save-document-position"));
      let converted = !p.book;
      p = migrateBook(p);
      // Font substitution is a display decision. Never rewrite authored choices on open.
      current.current = p;
      remember(p);
      revision.current = p.revision;
      dirty.current = converted;
      serial.current++;
      setProject(p);
      setSaveState("Saved");
      localStorage.setItem("alder.project", p.id);
    },
    [remember],
  );
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (flight.current) {
      await flight.current;
      if (!dirty.current) return;
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
          if (current.current) remember(current.current);
          setSaveState(dirty.current ? "Saving…" : "Saved");
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
  }, [remember]);
  // Serialize open/switch/close so a rapid second click cannot race a save.
  const transition = useCallback((action: () => Promise<void>) => {
    const next = transitions.current.then(action).catch((e) => {
      setError(String((e as Error).message));
    });
    transitions.current = next;
    return next;
  }, []);
  const load = useCallback(
    (p: Project) =>
      transition(async () => {
        const cached = opened.current.get(p.id) === p;
        await flush();
        install(cached ? opened.current.get(p.id)! : p);
      }),
    [transition, flush, install],
  );
  const activate = useCallback(
    (id: string) =>
      transition(async () => {
        if (id === current.current?.id) return;
        await flush();
        const next = opened.current.get(id);
        if (next) install(next);
      }),
    [transition, flush, install],
  );
  const close = useCallback(
    (id: string) =>
      transition(async () => {
        await flush();
        const ids = [...opened.current.keys()];
        if (!opened.current.has(id)) return;
        if (current.current?.id === id) {
          window.dispatchEvent(new Event("alder-save-document-position"));
          const index = ids.indexOf(id);
          const next = opened.current.get(ids[index + 1] || ids[index - 1]);
          if (next) install(next);
          else {
            current.current = null;
            setProject(null);
            localStorage.removeItem("alder.project");
          }
        }
        opened.current.delete(id);
        forgetSessionPosition(documentPositionKey(id));
        setDocuments((previous) => previous.filter((item) => item.id !== id));
      }),
    [transition, flush, install],
  );
  const findSource = useCallback(
    (source: string) =>
      [...opened.current.values()].find(
        (p) => localStorage.getItem("alder.documentSource." + p.id) === source,
      ),
    [],
  );
  const change = useCallback(
    (mutate: (draft: Project) => void) => {
      if (!current.current) return;
      const next = structuredClone(current.current);
      mutate(next);
      current.current = next;
      remember(next);
      serial.current++;
      dirty.current = true;
      setProject(next);
      setSaveState("Unsaved changes");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush().catch(() => {}), 500);
    },
    [flush, remember],
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
  return {
    project,
    documents,
    activate,
    close,
    findSource,
    change,
    load,
    flush,
    saveState,
    error,
    setError,
    history,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "./types";
import { api } from "./api";
import { createEditorDraft } from "./editorDraft";
import { migrateBook } from "./book";
import { forgetSessionPosition, documentPositionKey } from "./documentPosition";
import {
  currentEditorEdit,
  ProjectTimeline,
  shareProject,
} from "./projectTimeline";
import { registerProjectHistory } from "./projectHistoryBridge";
import {
  captureEditorSessions,
  rememberEditorSession,
  restoreEditorSessions,
} from "./editorSessions";
export function useProject() {
  const [project, setProject] = useState<Project | null>(null),
    [saveState, setSaveState] = useState("Opening project…"),
    [error, setError] = useState("");
  const [documents, setDocuments] = useState<{ id: string; name: string }[]>(
    [],
  );
  const opened = useRef(new Map<string, Project>());
  // Only untouched documents created in this session can be replaced automatically.
  const pristine = useRef(new Set<string>());
  const retain = useCallback((id: string) => {
    pristine.current.delete(id);
  }, []);
  const transitions = useRef(Promise.resolve());
  const timelines = useRef(new Map<string, ProjectTimeline>());
  const timelineFor = useCallback((id: string) => {
    let timeline = timelines.current.get(id);
    if (!timeline) {
      timeline = new ProjectTimeline();
      timelines.current.set(id, timeline);
    }
    return timeline;
  }, []);
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
      // An explicit reload may contain changes made outside this renderer.
      // Its durable saved versions remain available, but old local steps may
      // no longer address the same document and must not overwrite it.
      if (current.current?.id === p.id && current.current !== p)
        timelineFor(p.id).clear();
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
    [remember, timelineFor],
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
            current.current = shareProject(current.current!, saved);
            setProject(current.current);
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
    const next = transitions.current.then(action);
    // Keep the queue usable after a failure, but let an awaiting dialog or
    // file-open operation stop before claiming the handoff succeeded.
    transitions.current = next.catch((e) => {
      setError(String((e as Error).message));
    });
    return next;
  }, []);
  const load = useCallback(
    (p: Project, newlyCreated = false) =>
      transition(async () => {
        const cached = opened.current.get(p.id) === p;
        await flush();
        const previous = current.current;
        const replace =
          !newlyCreated &&
          previous &&
          previous.id !== p.id &&
          pristine.current.has(previous.id)
            ? previous.id
            : null;
        install(cached ? opened.current.get(p.id)! : p);
        if (newlyCreated && p.name === "Untitled" && !p.settings.author?.trim())
          pristine.current.add(p.id);
        else if (!cached) pristine.current.delete(p.id);
        if (replace) {
          opened.current.delete(replace);
          timelines.current.delete(replace);
          pristine.current.delete(replace);
          forgetSessionPosition(documentPositionKey(replace));
          setDocuments((previous) =>
            previous.filter((item) => item.id !== replace),
          );
        }
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
        timelines.current.delete(id);
        pristine.current.delete(id);
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
      const before = current.current;
      const origin = currentEditorEdit();
      if (origin && origin.projectId !== before.id) return;
      const editing = origin ? createEditorDraft(before) : null;
      const draft = editing?.project ?? structuredClone(before);
      mutate(draft);
      const next = shareProject(before, editing ? editing.finish() : draft);
      if (next === before) return;
      const editor = currentEditorEdit(next.id);
      timelineFor(next.id).record(
        before,
        next,
        editor,
        editor ? undefined : captureEditorSessions(next.id),
      );
      let retained = [...timelines.current.values()].reduce(
        (n, t) => n + t.retainedBytes,
        0,
      );
      for (const [id, timeline] of timelines.current) {
        if (retained <= 64 * 1024 * 1024) break;
        if (id === next.id) continue;
        retained -= timeline.retainedBytes;
        timeline.trimTo(0);
      }
      pristine.current.delete(next.id);
      current.current = next;
      remember(next);
      serial.current++;
      dirty.current = true;
      setProject(next);
      setSaveState("Unsaved changes");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush().catch(() => {}), 500);
    },
    [flush, remember, timelineFor],
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
  const history = useCallback(
    async (action: "undo" | "redo") => {
      const source = current.current;
      if (!source) return;
      const result = timelineFor(source.id).step(
        source,
        action,
        captureEditorSessions(source.id),
      );
      if (!result) return;
      if (result.sessions) restoreEditorSessions(result.sessions);
      if (result.editor)
        rememberEditorSession(
          result.editor.identity,
          action === "undo" ? result.editor.before : result.editor.after,
        );
      current.current = result.project;
      remember(result.project);
      serial.current++;
      dirty.current = true;
      setProject(result.project);
      setSaveState("Unsaved changes");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush().catch(() => {}), 500);
      if (result.editor)
        window.dispatchEvent(
          new CustomEvent("alder-history-source", {
            detail: { projectId: source.id, identity: result.editor.identity },
          }),
        );
    },
    [timelineFor, remember, flush],
  );
  useEffect(() => {
    if (!project) return;
    const id = project.id;
    return registerProjectHistory(id, {
      can: (direction) =>
        current.current?.id === id &&
        !!(direction === "undo" ? timelineFor(id).past : timelineFor(id).future)
          .length,
      breakBefore: (identity) => timelineFor(id).breakBefore(identity),
      run: (direction) => {
        if (current.current?.id === id)
          void history(direction).catch((e) =>
            setError(String(e.message || e)),
          );
      },
    });
  }, [project?.id, history, timelineFor]);
  return {
    project,
    retain,
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

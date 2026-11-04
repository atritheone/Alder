import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { api } from "./api";
import type { Project } from "./types";
type Source = { id: string; name: string; revision: number };
type Request = {
  originalId: string;
  revisedId: string;
  originalRevision: number;
  revisedRevision: number;
  author: string;
  mode: "compare" | "combine";
  choices?: Record<string, "original" | "revised">;
};
type Summary = {
  changes: number;
  comments: number;
  chapters: { title: string; changes: number }[];
  conflicts?: {
    id: string;
    paragraph: number;
    location?: string;
    chapter: string;
    original: string;
    revised: string;
    choice?: "original" | "revised";
  }[];
  reanchoredComments?: number;
};
export default function CompareDocumentsDialog({
  project,
  mode = "compare",
  onOpen,
  onClose,
}: {
  project: Project;
  mode?: "compare" | "combine";
  onOpen: (value: Project) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    active = useRef(true);
  const combining = mode === "combine",
    title = combining ? "Combine reviewed copies" : "Compare documents";
  const [sources, setSources] = useState<Source[]>([]),
    [original, setOriginal] = useState(project.id),
    [revised, setRevised] = useState("");
  const [author, setAuthor] = useState(
      project.settings.reviewAuthor || project.settings.author || "Reviewer",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    request: Request;
    summary: Summary;
  } | null>(null);
  useEffect(() => {
    active.current = true;
    dialog.current?.showModal();
    void api<{ projects: Source[] }>("/api/projects")
      .then((result) => {
        if (active.current) setSources(result.projects);
      })
      .catch((cause) => {
        if (active.current) setError(cause.message);
      });
    return () => {
      active.current = false;
      dialog.current?.close();
    };
  }, []);
  const invalidate = () => {
    setPreview(null);
    setError("");
  };
  const run = async (create: boolean, choices?: Request["choices"]) => {
    setBusy(true);
    setError("");
    try {
      let request = preview?.request;
      if (choices && request) request = { ...request, choices };
      else if (!create) {
        const latest = await api<{ projects: Source[] }>("/api/projects");
        if (!active.current) return;
        setSources(latest.projects);
        const a = latest.projects.find((s) => s.id === original),
          b = latest.projects.find((s) => s.id === revised);
        if (!a || !b) throw Error("Choose two available documents.");
        request = {
          originalId: a.id,
          revisedId: b.id,
          originalRevision: a.revision,
          revisedRevision: b.revision,
          author: author.trim(),
          mode,
        };
      }
      if (!request) throw Error("Preview the comparison first.");
      const result = await api<Summary & { project?: Project }>(
        "/api/document-comparison",
        "POST",
        { ...request, create },
      );
      if (!active.current) return;
      if (create && result.project) await onOpen(result.project);
      else setPreview({ request, summary: result });
    } catch (cause) {
      if (active.current) {
        setError((cause as Error).message);
        setPreview(null);
      }
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog compare-dialog"
      aria-label={title}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(!!preview);
        }}
      >
        <header>
          <strong>{title}</strong>
          <button
            type="button"
            disabled={busy}
            aria-label="Close comparison"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <p>
            {combining
              ? "Choose two reviewed copies of the same original. Their authors, pending changes and comments are kept in a new copy. Choose which review to keep where changes conflict."
              : "Open both files in Alder, then choose the original and revised copies. Text and formatting changes appear in a new reviewed document. Page setup comes from the original."}
          </p>
          <label>
            {combining ? "First" : "Original"}
            <select
              aria-label={
                combining ? "First reviewed copy" : "Original document"
              }
              disabled={busy}
              value={original}
              onChange={(e) => {
                setOriginal(e.target.value);
                invalidate();
              }}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {combining ? "Second" : "Revised"}
            <select
              aria-label={
                combining ? "Second reviewed copy" : "Revised document"
              }
              disabled={busy}
              value={revised}
              onChange={(e) => {
                setRevised(e.target.value);
                invalidate();
              }}
            >
              <option value="">Choose document</option>
              {sources
                .filter((s) => s.id !== original)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          {!combining && (
            <label>
              Author
              <input
                aria-label="Comparison author"
                disabled={busy}
                maxLength={200}
                value={author}
                onChange={(e) => {
                  setAuthor(e.target.value);
                  invalidate();
                }}
              />
            </label>
          )}
          {preview && (
            <section aria-label="Comparison summary">
              <p>
                {preview.summary.changes}{" "}
                {preview.summary.changes === 1 ? "change" : "changes"}
              </p>
              <p>
                {preview.summary.comments}{" "}
                {preview.summary.comments === 1 ? "comment" : "comments"}
              </p>
              {preview.summary.chapters.length > 1 && (
                <ul>
                  {preview.summary.chapters.map((c, i) => (
                    <li key={i}>
                      {c.title} · {c.changes}
                    </li>
                  ))}
                </ul>
              )}
              {preview.summary.conflicts?.map((conflict) => (
                <section
                  key={conflict.id}
                  className="review-conflict"
                  aria-label={`Conflict at ${conflict.location || `paragraph ${conflict.paragraph}`}`}
                >
                  <strong>
                    {conflict.chapter} · {conflict.location || `Paragraph ${conflict.paragraph}`}
                  </strong>
                  <p>
                    {sources.find((s) => s.id === original)?.name}:{" "}
                    {conflict.original || "(Removed)"}
                  </p>
                  <p>
                    {sources.find((s) => s.id === revised)?.name}:{" "}
                    {conflict.revised || "(Removed)"}
                  </p>
                  <label>
                    Keep review from
                    <select
                      aria-label={`Keep review at ${conflict.location || `paragraph ${conflict.paragraph}`}`}
                      disabled={busy}
                      value={conflict.choice || ""}
                      onChange={(e) => {
                        void run(false, {
                          ...preview.request.choices,
                          [conflict.id]: e.target.value as
                            | "original"
                            | "revised",
                        });
                      }}
                    >
                      <option value="" disabled>
                        Choose copy
                      </option>
                      <option value="original">
                        {sources.find((s) => s.id === original)?.name}
                      </option>
                      <option value="revised">
                        {sources.find((s) => s.id === revised)?.name}
                      </option>
                    </select>
                  </label>
                </section>
              ))}
              {!!preview.summary.reanchoredComments && (
                <p>
                  {preview.summary.reanchoredComments} comment ranges move to
                  the nearest retained wording where their original text is
                  removed.
                </p>
              )}
            </section>
          )}
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">Preparing review…</p>}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              busy ||
              !original ||
              !revised ||
              original === revised ||
              (!combining && !author.trim()) ||
              !!preview?.summary.conflicts?.some((c) => !c.choice)
            }
          >
            {preview ? "Create reviewed copy" : "Preview"}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

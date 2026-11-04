import { formatInteger } from "./numberDisplay";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Node as PMNode } from "prosemirror-model";
import { outlinePreviewFragment } from "./outlineLists";
import { X } from "lucide-react";
import { reviewChanges, reviewedDocument } from "./trackedReview";
import type { ReviewView } from "./trackedChanges";

export type ReviewPreferences = { tracking: boolean; author: string };
export default function ReviewDialog({
  doc,
  selection,
  preferences,
  onPreferences,
  onResolve,
  onGo,
  onClose,
  book,
}: {
  doc: PMNode;
  selection: { from: number; to: number };
  preferences: ReviewPreferences;
  onPreferences: (value: ReviewPreferences) => void;
  onResolve: (ids: ReadonlySet<string>, decision: "accept" | "reject") => void;
  onGo: (from: number, to: number) => void;
  onClose: () => void;
  book?: {
    sources: { id: string; title: string; doc: PMNode }[];
    currentId: string;
    onResolve: (
      ids: ReadonlySet<string>,
      decision: "accept" | "reject",
    ) => void;
    onGo: (id: string, from: number, to: number) => void;
  };
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    preview = useRef<HTMLDivElement>(null);
  const [coverage, setCoverage] = useState("chapter");
  const changes = useMemo(
    () =>
      coverage === "book" && book
        ? book.sources.flatMap((source) =>
            reviewChanges(source.doc).map((c) => ({
              ...c,
              chapterId: source.id,
              chapterTitle: source.title,
            })),
          )
        : reviewChanges(doc).map((c) => ({
            ...c,
            chapterId: book?.currentId || "",
            chapterTitle: "",
          })),
    [doc, book, coverage],
  );
  const [selected, setSelected] = useState(changes[0]?.id || ""),
    [author, setAuthor] = useState(preferences.author),
    [filter, setFilter] = useState(""),
    [scope, setScope] = useState("current"),
    [view, setView] = useState<ReviewView>("markup"),
    [error, setError] = useState("");
  const visible = changes.filter((c) => !filter || c.author === filter),
    current = visible.find((c) => c.id === selected) || visible[0];
  const previewDoc =
    coverage === "book"
      ? book?.sources.find((s) => s.id === current?.chapterId)?.doc || doc
      : doc;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    try {
      const document = reviewedDocument(previewDoc, view);
      preview.current?.replaceChildren(outlinePreviewFragment(document));
      setError("");
    } catch (cause) {
      preview.current?.replaceChildren();
      setError((cause as Error).message);
    }
  }, [previewDoc, view]);
  const saveAuthor = () => {
    if (author.trim() && author.trim() !== preferences.author)
      onPreferences({ ...preferences, author: author.trim() });
  };
  const close = () => {
    saveAuthor();
    onClose();
  };
  const targets =
    scope === "all"
      ? changes
      : scope === "author"
        ? visible
        : scope === "selection"
          ? changes.filter((c) =>
              c.ranges.some(
                (r) => r.from < selection.to && r.to > selection.from,
              ),
            )
          : current
            ? [current]
            : [];
  const resolve = (decision: "accept" | "reject") => {
    try {
      (coverage === "book" && book ? book.onResolve : onResolve)(
        new Set(targets.map((c) => c.id)),
        decision,
      );
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog review-dialog"
      aria-label="Review changes"
      onCancel={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <header>
          <strong>Review changes</strong>
          <button type="button" aria-label="Close review" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          {book && (
            <label>
              Review
              <select
                aria-label="Review coverage"
                value={coverage}
                onChange={(e) => {
                  setCoverage(e.target.value);
                  setScope("current");
                  setFilter("");
                }}
              >
                <option value="chapter">Current chapter</option>
                <option value="book">All chapters</option>
              </select>
            </label>
          )}
          <label>
            Author
            <input
              aria-label="Review author"
              value={author}
              maxLength={200}
              onChange={(e) => setAuthor(e.target.value)}
              onBlur={saveAuthor}
            />
          </label>
          <label>
            Track changes
            <input
              type="checkbox"
              checked={preferences.tracking}
              disabled={!author.trim()}
              onChange={(e) =>
                onPreferences({
                  tracking: e.target.checked,
                  author: author.trim(),
                })
              }
            />
          </label>
          <p className="review-support">
            Track text, moves, formatting, paragraph breaks, and complete table
            or row insertions and deletions. Select all connected rows when
            changing a vertically merged cell.
          </p>
          <div className="comments-actions">
            <label>
              Show
              <select
                aria-label="Review author filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">All authors</option>
                {[...new Set(changes.map((c) => c.author))].map((name) => (
                  <option key={name} value={name}>
                    {name || "Unnamed author"}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {formatInteger(visible.length)} {visible.length === 1 ? "change" : "changes"}
            </span>
            <button
              type="button"
              disabled={!current || visible.indexOf(current) <= 0}
              onClick={() =>
                setSelected(visible[visible.indexOf(current!) - 1].id)
              }
            >
              Previous
            </button>
            <button
              type="button"
              disabled={
                !current || visible.indexOf(current) >= visible.length - 1
              }
              onClick={() =>
                setSelected(visible[visible.indexOf(current!) + 1].id)
              }
            >
              Next
            </button>
          </div>
          <div
            className="comments-list review-list"
            aria-label="Pending changes"
          >
            {visible.map((change) => (
              <button
                type="button"
                key={change.id}
                aria-pressed={change.id === current?.id}
                onClick={() => setSelected(change.id)}
              >
                <strong>{change.author || "Unnamed author"}</strong>
                {coverage === "book" && <small>{change.chapterTitle}</small>}
                <small>
                  {change.date
                    ? new Date(change.date).toLocaleString()
                    : "Date unavailable"}
                </small>
                {change.ranges
                  .map(
                    (r) =>
                      `${change.move ? (r.kind === "insertion" ? "Moved to" : "Moved from") : r.kind === "formatting" ? "Formatting" : r.kind === "insertion" ? "Inserted" : "Deleted"}: ${r.text}`,
                  )
                  .join(" · ")
                  .slice(0, 240)}
              </button>
            ))}
          </div>
          <div className="comments-actions">
            <label>
              Apply to
              <select
                aria-label="Review scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="current">Current change</option>
                <option
                  value="selection"
                  disabled={
                    coverage === "book" || selection.from === selection.to
                  }
                >
                  Selection
                </option>
                <option value="author" disabled={!filter}>
                  Shown author
                </option>
                <option value="all">All changes</option>
              </select>
            </label>
            <button
              type="button"
              disabled={!targets.length || (scope === "author" && !filter)}
              onClick={() => resolve("accept")}
            >
              Accept
            </button>
            <button
              type="button"
              disabled={!targets.length || (scope === "author" && !filter)}
              onClick={() => resolve("reject")}
            >
              Reject
            </button>
            <button
              type="button"
              disabled={!current}
              onClick={() => {
                if (current) {
                  saveAuthor();
                  try {
                    (coverage === "book" && book
                      ? (from: number, to: number) =>
                          book.onGo(current.chapterId, from, to)
                      : onGo)(
                      Math.min(...current.ranges.map((r) => r.from)),
                      Math.max(...current.ranges.map((r) => r.to)),
                    );
                  } catch (cause) {
                    setError((cause as Error).message);
                  }
                }
              }}
            >
              Go to change
            </button>
          </div>
          <label>
            Document preview
            <select
              aria-label="Review preview"
              value={view}
              onChange={(e) => setView(e.target.value as ReviewView)}
            >
              <option value="markup">Markup</option>
              <option value="final">Final</option>
              <option value="original">Original</option>
            </select>
          </label>
          <div
            ref={preview}
            className="review-preview"
            aria-label={`${view} document preview`}
            onClick={(e) => {
              if ((e.target as Element).closest("a")) e.preventDefault();
            }}
          />
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="submit">Done</button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

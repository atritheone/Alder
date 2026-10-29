import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  commentEntry,
  type CommentThread,
  type DocumentComment,
} from "./documentComments";

export default function CommentsDialog({
  items,
  initial,
  onAdd,
  onChange,
  onGo,
  onReanchor,
  onClose,
}: {
  items: DocumentComment[];
  initial?: string;
  onAdd: (thread: CommentThread) => boolean;
  onChange: (id: string, thread: CommentThread | null) => boolean;
  onGo: (id: string) => void;
  onReanchor: (id: string) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(initial || ""),
    [text, setText] = useState(""),
    [error, setError] = useState("");
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem("alder-comment-author") || "";
    } catch {
      return "";
    }
  });
  const [showResolved, setShowResolved] = useState(true),
    [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  const current = items.find((item) => item.id === selected),
    visible = items.filter((item) => showResolved || !item.thread.resolved);
  const check = (ok: boolean) => {
    setError(
      ok
        ? ""
        : "The document changed. Close this window and select the passage again.",
    );
    return ok;
  };
  const submit = () => {
    if (!text.trim() || !author.trim()) return;
    const entry = commentEntry(author, text);
    const thread = current
      ? {
          ...current.thread,
          entries: editing
            ? current.thread.entries.map((e) =>
                e.id === editing ? { ...e, text: entry.text } : e,
              )
            : [...current.thread.entries, entry],
        }
      : { entries: [entry], resolved: false };
    if (check(current ? onChange(current.id, thread) : onAdd(thread))) {
      try {
        localStorage.setItem("alder-comment-author", author.trim());
      } catch {
        /* preference storage may be unavailable */
      }
      setText("");
      setEditing(null);
      if (!current) close();
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog comments-dialog"
      aria-label="Comments"
      onCancel={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <header>
          <strong>Comments</strong>
          <button type="button" aria-label="Close comments" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <div className="comments-actions">
            <button
              type="button"
              disabled={
                !visible.length ||
                visible.findIndex((item) => item.id === selected) <= 0
              }
              onClick={() => {
                const index = visible.findIndex((item) => item.id === selected);
                if (index > 0) {
                  setSelected(visible[index - 1].id);
                  setText("");
                  setEditing(null);
                }
              }}
            >
              Previous comment
            </button>
            <button
              type="button"
              disabled={
                !visible.length ||
                visible.findIndex((item) => item.id === selected) ===
                  visible.length - 1
              }
              onClick={() => {
                const index = visible.findIndex((item) => item.id === selected);
                if (index + 1 < visible.length) {
                  setSelected(visible[index + 1].id);
                  setText("");
                  setEditing(null);
                }
              }}
            >
              Next comment
            </button>
            <button
              type="button"
              onClick={() => {
                setSelected("");
                setText("");
                setEditing(null);
              }}
            >
              New comment
            </button>
            <label>
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Show resolved
            </label>
          </div>
          {visible.length > 0 && (
            <div
              className="comments-list"
              role="list"
              aria-label="Comments in this document"
            >
              {visible.map((item) => (
                <button
                  type="button"
                  role="listitem"
                  key={item.id}
                  aria-pressed={selected === item.id}
                  onClick={() => {
                    setSelected(item.id);
                    setText("");
                    setEditing(null);
                  }}
                >
                  <strong>
                    {item.thread.entries[0].author || "Unknown author"}
                  </strong>{" "}
                  {item.thread.entries[0].text}
                  <small>
                    {item.incomplete
                      ? "Anchor incomplete"
                      : item.context || "Cursor position"}
                    {item.thread.resolved ? " · Resolved" : ""}
                  </small>
                </button>
              ))}
            </div>
          )}
          {current && (
            <section aria-label="Selected comment" className="comment-thread">
              <div className="comments-actions">
                <button
                  type="button"
                  onClick={() => {
                    dialog.current?.close();
                    onGo(current.id);
                  }}
                >
                  Go to passage
                </button>
                <button
                  type="button"
                  onClick={() =>
                    check(
                      onChange(current.id, {
                        ...current.thread,
                        resolved: !current.thread.resolved,
                      }),
                    )
                  }
                >
                  {current.thread.resolved ? "Reopen" : "Resolve"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (check(onChange(current.id, null))) {
                      setSelected("");
                      setText("");
                      setEditing(null);
                    }
                  }}
                >
                  Delete thread
                </button>
              </div>
              {current.incomplete && (
                <div role="status">
                  Part of this anchor is missing.{" "}
                  <button
                    type="button"
                    onClick={() => check(onReanchor(current.id))}
                  >
                    Attach to current selection
                  </button>
                </div>
              )}
              {current.thread.entries.map((entry) => (
                <article key={entry.id}>
                  <strong>{entry.author || "Unknown author"}</strong>
                  {entry.date && (
                    <time dateTime={entry.date}>
                      {new Date(entry.date).toLocaleString()}
                    </time>
                  )}
                  <p>{entry.text}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(entry.id);
                      setText(entry.text);
                    }}
                  >
                    Edit comment
                  </button>
                  {current.thread.entries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          check(
                            onChange(current.id, {
                              ...current.thread,
                              entries: current.thread.entries.filter(
                                (e) => e.id !== entry.id,
                              ),
                            }),
                          )
                        ) {
                          setEditing(null);
                          setText("");
                        }
                      }}
                    >
                      Delete comment
                    </button>
                  )}
                </article>
              ))}
            </section>
          )}
          <label>
            Author
            <input
              aria-label="Comment author"
              value={author}
              maxLength={200}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <label>
            {editing ? "Edit comment" : current ? "Reply" : "Comment"}
            <textarea
              autoFocus
              aria-label="Comment text"
              rows={3}
              maxLength={10000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </label>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" onClick={close}>
            Close
          </button>
          <button
            type="submit"
            className="accent"
            disabled={
              !text.trim() ||
              !author.trim() ||
              (!editing && !!current && current.thread.entries.length >= 1000)
            }
          >
            {editing ? "Save comment" : current ? "Reply" : "Add comment"}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

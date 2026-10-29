import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { documentBookmarks } from "./documentBookmarks";
import { validBookmarkName } from "./documentBookmarks";

export default function BookmarksDialog({
  items,
  onAdd,
  onChange,
  onGo,
  onClose,
}: {
  items: ReturnType<typeof documentBookmarks>;
  onAdd: (name: string) => boolean;
  onChange: (id: string, name: string | null) => boolean;
  onGo: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    // End native modality before restoring the editor's caret and focus.
    dialog.current?.close();
    onClose();
  };
  const apply = () => {
    if (!validBookmarkName(name)) {
      setError(
        "Start with a letter; use up to 40 letters, numbers or underscores.",
      );
      return;
    }
    const ok = selected ? onChange(selected, name) : onAdd(name);
    if (!ok)
      setError(
        "That name is already used, or the document changed. Select the position again.",
      );
    else close();
  };
  return createPortal(
    <dialog
      className="word-dialog"
      aria-label="Document bookmarks"
      ref={dialog}
      onCancel={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <header>
          <strong>Bookmarks</strong>
          <button type="button" aria-label="Close bookmarks" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Bookmark name
            <input
              autoFocus
              aria-label="Bookmark name"
              value={name}
              maxLength={40}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
            />
          </label>
          <small>
            A bookmark follows the selected text, or the cursor position when
            nothing is selected. Names use letters, numbers and underscores.
          </small>
          {items.length > 0 && (
            <div role="list" aria-label="Document bookmarks">
              {items.map((item) => (
                <div role="listitem" key={item.id} className="bookmark-row">
                  <button
                    type="button"
                    title={item.context}
                    aria-pressed={selected === item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setName(item.name);
                    }}
                  >
                    {item.name}
                    {item.incomplete
                      ? " — incomplete"
                      : item.end != null
                        ? " — passage"
                        : ""}
                  </button>
                  <button
                    type="button"
                    aria-label={`Go to ${item.name}`}
                    onClick={() => {
                      dialog.current?.close();
                      onGo(item.id);
                    }}
                  >
                    Go to
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => {
                      if (onChange(item.id, null)) close();
                      else
                        setError("The bookmark changed. Open Bookmarks again.");
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          {selected && (
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setName("");
              }}
            >
              New
            </button>
          )}
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="accent">
            {selected ? "Rename" : "Add"}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

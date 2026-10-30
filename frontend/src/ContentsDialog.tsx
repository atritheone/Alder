import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { NamedStyle } from "./types";
import { type ContentsOptions, validContentsOptions } from "./documentContents";
export default function ContentsDialog({
  initial,
  styles,
  onApply,
  onClose,
}: {
  initial?: ContentsOptions;
  styles: NamedStyle[];
  onApply: (options: ContentsOptions) => void | Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    closed = useRef(false),
    [value, setValue] = useState<ContentsOptions>(
      initial || { title: "Contents", depth: 3, entryStyle: null },
    );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    closed.current = true;
    dialog.current?.close();
    onClose();
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog"
      aria-label="Table of contents"
      onCancel={close}
      aria-busy={busy}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (validContentsOptions(value) && !busy) {
            setBusy(true);
            setError("");
            try {
              await onApply(value);
              if (!closed.current) close();
            } catch (error) {
              if (!closed.current) {
                setError(String((error as Error).message));
                setBusy(false);
              }
            }
          }
        }}
      >
        <header>
          <strong>Table of contents</strong>
          <button type="button" aria-label="Close contents" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Include
            <select
              aria-label="Contents type"
              value={value.kind || "headings"}
              disabled={busy}
              onChange={(e) => {
                const kind = e.target.value as ContentsOptions["kind"];
                const titles = {
                  headings: "Contents",
                  figures: "List of figures",
                  tables: "List of tables",
                  index: "Index",
                };
                setValue({
                  ...value,
                  kind,
                  ...(kind==='index'?{pageNumbers:true}:{}),
                  title: Object.values(titles).includes(value.title)
                    ? titles[kind!]
                    : value.title,
                });
              }}
            >
              <option value="headings">Headings</option>
              <option value="figures">Figures</option>
              <option value="tables">Tables</option>
              <option value="index">Index entries</option>
            </select>
          </label>
          {value.kind!=='index'&&<label>
            <input
              type="checkbox"
              disabled={busy}
              checked={value.pageNumbers !== false}
              onChange={(e) =>
                setValue({ ...value, pageNumbers: e.target.checked })
              }
            />
            Page numbers
          </label>}
          <label>
            Title
            <input
              autoFocus
              aria-label="Contents title"
              disabled={busy}
              value={value.title}
              maxLength={200}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
            />
          </label>
          {(!value.kind || value.kind === "headings") && (
            <label>
              Heading levels
              <select
                aria-label="Contents heading levels"
                disabled={busy}
                value={value.depth}
                onChange={(e) =>
                  setValue({ ...value, depth: Number(e.target.value) })
                }
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "1" : `1–${n}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Entry style
            <select
              aria-label="Contents entry style"
              disabled={busy}
              value={value.entryStyle || ""}
              onChange={(e) =>
                setValue({ ...value, entryStyle: e.target.value || null })
              }
            >
              <option value="">Document default</option>
              {styles
                .filter((s) => s.kind !== "character")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <small>
            Includes headings, captions or index entries from included chapters. Edit → Update
            fields refreshes entries. Ctrl-click (Command-click on Mac) an entry
            to go to its source.
          </small>
        </div>
        <footer>
          {error && <span role="alert">{error}</span>}
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            className="accent"
            disabled={busy || !validContentsOptions(value)}
          >
            {busy ? "Paginating…" : initial ? "Apply" : "Insert"}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

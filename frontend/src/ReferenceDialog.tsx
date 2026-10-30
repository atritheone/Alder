import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { ReferenceIndex } from "./documentReferences";
import { referenceFormat, type ReferenceFormat } from "./documentReferences";

export default function ReferenceDialog({
  index,
  onInsert,
  onClose,
}: {
  index: ReferenceIndex;
  onInsert: (id: string, text: string, format: ReferenceFormat) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [target, setTarget] = useState(""),
    [format, setFormat] = useState<ReferenceFormat>("text"),
    [query, setQuery] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  const isCaption = index.targets.get(target)?.kind === "caption";
  const isNote = index.targets.get(target)?.kind === "note";
  const isNumberedHeading =
    index.targets.get(target)?.kind === "heading" &&
    !!index.targets.get(target)?.number;
  const effectiveFormat =
    format === "page" || isCaption || ((isNote||isNumberedHeading) && format === "number")
      ? format
      : "text";
  const text =
    effectiveFormat === "page"
      ? index.targets.get(target)?.valid
        ? "—"
        : null
      : index.resolve(target, effectiveFormat);
  const items = [...index.targets.values()].filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog"
      aria-label="Insert cross-reference"
      onCancel={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (text) {
            dialog.current?.close();
            onInsert(target, text, effectiveFormat);
            onClose();
          }
        }}
      >
        <header>
          <strong>Insert cross-reference</strong>
          <button
            type="button"
            aria-label="Close cross-reference"
            onClick={close}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Find a target
            <input
              autoFocus
              aria-label="Find reference target"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {target && (
            <label>
              Display
              <select
                aria-label="Reference display"
                value={effectiveFormat}
                onChange={(event) =>
                  setFormat(referenceFormat(event.target.value))
                }
              >
                <option value="text" disabled={!index.resolve(target)}>
                  {isCaption
                    ? "Full caption"
                    : index.targets.get(target)?.kind === "heading"
                      ? "Heading text"
                      : "Passage text"}
                </option>
                {isCaption && (
                  <option value="labelNumber">Label and number</option>
                )}
                {(isCaption || isNumberedHeading || isNote) && (
                  <option value="number">Number only</option>
                )}
                <option value="page">Page number</option>
              </select>
            </label>
          )}
          <label>
            Reference to
            <select
              aria-label="Reference target"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                if (!index.resolve(event.target.value)) setFormat(index.targets.get(event.target.value)?.kind==='note'?'number':"page");
              }}
            >
              <option value="">Choose a target…</option>
              {(["heading", "bookmark", "caption", "note"] as const).map((kind) => (
                <optgroup
                  key={kind}
                  label={
                    kind === "heading"
                      ? "Headings"
                      : kind === "caption"
                        ? "Captions"
                        : kind==='note' ? 'Notes' : "Bookmarked passages"
                  }
                >
                  {items
                    .filter((item) => item.kind === kind)
                    .map((item) => (
                      <option
                        key={item.id}
                        value={item.id}
                        disabled={!item.valid}
                      >
                        {item.label}
                        {!item.valid ? " — unavailable" : ""}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          {text && (
            <p className="reference-preview" aria-label="Reference preview">
              {text}
            </p>
          )}
          <small>
            Edit → Update fields refreshes wording and page numbers together.
            PDF refreshes page numbers automatically; Word uses native fields.
            Bookmark a selection to reference a passage.
          </small>
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="accent" disabled={!text}>
            Insert
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

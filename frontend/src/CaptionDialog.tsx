import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CaptionLabel } from "./documentCaptions";
export default function CaptionDialog({
  label,
  onApply,
  onClose,
}: {
  label: CaptionLabel;
  onApply: (
    label: CaptionLabel,
    title: string,
    position: "before" | "after",
  ) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [title, setTitle] = useState(""),
    [kind, setKind] = useState(label),
    [position, setPosition] = useState<"before" | "after">(
      label === "Table" ? "before" : "after",
    );
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const close = () => {
    ref.current?.close();
    onClose();
  };
  return createPortal(
    <dialog
      ref={ref}
      className="word-dialog"
      aria-label="Insert caption"
      onCancel={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) {
            ref.current?.close();
            onApply(kind, title, position);
            onClose();
          }
        }}
      >
        <header>
          <strong>Insert caption</strong>
          <button type="button" aria-label="Close caption" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Caption
            <input
              aria-label="Caption text"
              autoFocus
              value={title}
              maxLength={1000}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Label
            <select
              aria-label="Caption label"
              value={kind}
              onChange={(event) => setKind(event.target.value as CaptionLabel)}
            >
              <option>Figure</option>
              <option>Table</option>
            </select>
          </label>
          <label>
            Position
            <select
              aria-label="Caption position"
              value={position}
              onChange={(event) =>
                setPosition(event.target.value as "before" | "after")
              }
            >
              <option value="before">Above</option>
              <option value="after">Below</option>
            </select>
          </label>
          <small>
            Edit caption wording directly in the document. Update fields
            refreshes document numbering and references together.
          </small>
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="accent" type="submit" disabled={!title.trim()}>
            Insert
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

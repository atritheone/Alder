import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  fieldLabels,
  documentFieldValues,
  type DocumentField,
  isPageField,
  isLayoutField,
} from "./documentFields";
import type { Project } from "./types";
import { isHeadingField } from "./runningHeadings";

export default function FieldDialog({
  project,
  onInsert,
  onClose,
  allowPageFields = true,
}: {
  project: Project;
  onInsert: (kind: DocumentField, text: string) => void | Promise<void>;
  onClose: () => void;
  allowPageFields?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [kind, setKind] = useState<DocumentField>("date"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    closed = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    closed.current = true;
    dialog.current?.close();
    onClose();
  };
  const value = documentFieldValues(project)[kind];
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog"
      aria-label="Insert field"
      onCancel={close}
    >
      <form
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!value || busy) return;
          setBusy(true);
          setError("");
          try {
            await onInsert(kind, value);
            if (!closed.current) close();
          } catch (cause) {
            if (!closed.current) {
              setError(cause instanceof Error ? cause.message : String(cause));
              setBusy(false);
            }
          }
        }}
      >
        <header>
          <strong>Insert field</strong>
          <button type="button" aria-label="Close field dialog" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Field
            <select
              autoFocus
              aria-label="Field"
              value={kind}
              disabled={busy}
              onChange={(event) => setKind(event.target.value as DocumentField)}
            >
              {Object.entries(fieldLabels)
                .filter(([value]) => allowPageFields || !isLayoutField(value))
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <p className="reference-preview" aria-label="Field preview">
            {value ||
              "Set this document property in Settings before inserting it."}
          </p>
          <small>
            {isHeadingField(kind)
              ? "Shows the nearest preceding heading at this level, or the first following heading. Update fields refreshes it after editing. In headers and footers, it follows the first heading on each page."
              : isPageField(kind)
                ? "Calculated from the complete publication when inserted, updated or exported to PDF. Page numbers follow section numbering."
                : kind === "date"
                  ? "The current date uses YYYY-MM-DD. It changes when you update fields or export."
                  : "Edit → Update fields refreshes this document property; exports refresh automatically."}
          </small>
        </div>
        <footer>
          {error && <span role="alert">{error}</span>}
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="accent" disabled={!value || busy}>
            {busy ? "Paginating…" : "Insert"}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

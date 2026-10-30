import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import StoryEditor from "./StoryEditor";
import { emptyStory } from "./runningMatter";
import {
  validDocumentNote,
  type DocumentNote,
  type documentNotes,
} from "./documentNotes";
import type { Asset, NamedStyle } from "./types";
export default function NotesDialog({
  entries,
  initialId,
  styles,
  fontFamily,
  language,
  onApply,
  onGo,
  onClose,
  assets,
  projectId,
  onCollect,
}: {
  entries: ReturnType<typeof documentNotes>;
  initialId?: string;
  styles: NamedStyle[];
  fontFamily: string;
  language: string;
  assets: Asset[];
  projectId: string;
  onCollect: (file: File) => Promise<Asset>;
  onApply: (value: DocumentNote | null, id?: string) => boolean;
  onGo: (id: string) => void;
  onClose: () => void;
}) {
  const initial = entries.find((note) => note.id === initialId),
    dialog = useRef<HTMLDialogElement>(null);
  const [id, setId] = useState(initial?.id || ""),
    [value, setValue] = useState<DocumentNote>(
      initial?.value || { kind: "footnote", body: emptyStory() },
    ),
    [version, setVersion] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const apply = (remove = false) => {
    if (onApply(remove ? null : value, id || undefined)) onClose();
    else setError("The document changed. Open Notes again.");
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog running-matter-dialog"
      aria-label="Notes"
      onCancel={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (validDocumentNote(value)) apply();
        }}
      >
        <header>
          <strong>Notes</strong>
          <button type="button" aria-label="Close notes" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Note
            <select
              aria-label="Note"
              value={id}
              onChange={(e) => {
                const entry = entries.find(
                  (note) => note.id === e.target.value,
                );
                setId(e.target.value);
                setValue(
                  entry?.value || { kind: "footnote", body: emptyStory() },
                );
                setVersion((v) => v + 1);
              }}
            >
              <option value="">New note at selection</option>
              {entries.map((note) => (
                <option key={note.id} value={note.id}>
                  {note.value.kind === "footnote" ? "Footnote" : "Endnote"}{" "}
                  {note.number}
                </option>
              ))}
            </select>
          </label>
          <label>
            Placement
            <select
              aria-label="Note placement"
              value={value.kind}
              onChange={(e) =>
                setValue({
                  ...value,
                  kind: e.target.value as DocumentNote["kind"],
                })
              }
            >
              <option value="footnote">Footnote</option>
              <option value="endnote">Endnote</option>
            </select>
          </label>
          <StoryEditor
            key={version}
            mode="note"
            document={value.body}
            onChange={(body) => setValue((v) => ({ ...v, body }))}
            styles={styles}
            fontFamily={fontFamily}
            fields={{} as any}
            label="Note text"
            language={language}
            assets={assets}
            projectId={projectId}
            onCollect={onCollect}
          />
        </div>
        <footer>
          {error && <span role="alert">{error}</span>}
          {id && (
            <>
              <button
                type="button"
                onClick={() => {
                  onGo(id);
                  onClose();
                }}
              >
                Go to reference
              </button>
              <button type="button" onClick={() => apply(true)}>
                Remove
              </button>
            </>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!validDocumentNote(value)}>
            {id ? "Apply" : "Insert"}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

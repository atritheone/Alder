import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  validIndexEntry,
  type IndexEntry,
  type indexEntries,
} from "./documentIndex";

export default function IndexEntriesDialog({
  entries,
  ranges,
  selection,
  onApply,
  onGo,
  onClose,
}: {
  entries: ReturnType<typeof indexEntries>;
  ranges: {id:string;name:string}[];
  selection: string;
  onApply: (value: IndexEntry | null, id?: string) => boolean;
  onGo: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [id, setId] = useState(""),
    [terms, setTerms] = useState([selection.slice(0, 200).trim(), "", ""]),
    [see, setSee] = useState(""),
    [rangeId,setRangeId]=useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  const value = {
    terms: terms
      .filter((term, index) => index === 0 || terms.slice(index).some(Boolean))
      .map((term) => term.trim()),
    see: see.trim() || null,
    rangeId: rangeId || null,
  };
  const apply = (remove = false) => {
    if(!remove && rangeId && !ranges.some(r=>r.id===rangeId)){setError('Choose an available bookmark range, or use the current page.');return;}
    if (onApply(remove ? null : value, id || undefined)) close();
    else setError("The document changed. Open Index entries again.");
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog"
      aria-label="Index entries"
      onCancel={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (validIndexEntry(value)) apply();
        }}
      >
        <header>
          <strong>Index entries</strong>
          <button
            type="button"
            aria-label="Close index entries"
            onClick={close}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Entry
            <select
              aria-label="Index entry"
              value={id}
              onChange={(event) => {
                const entry = entries.find(
                  (entry) => entry.id === event.target.value,
                );
                setId(event.target.value);
                setTerms(
                  entry
                    ? [
                        ...entry.terms,
                        ...Array(3 - entry.terms.length).fill(""),
                      ]
                    : [selection.slice(0, 200).trim(), "", ""],
                );
                setSee(entry?.see || "");
                setRangeId(entry?.rangeId || "");
                setError("");
              }}
            >
              <option value="">New entry at selection</option>
              {entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.terms.join(" › ")} — {entry.context}
                </option>
              ))}
            </select>
          </label>
          {["Main entry", "Subentry", "Further subentry"].map(
            (label, index) => (
              <label key={label}>
                {label}
                <input
                  autoFocus={index === 0}
                  aria-label={label}
                  maxLength={200}
                  value={terms[index]}
                  onChange={(event) =>
                    setTerms(
                      terms.map((term, i) =>
                        i === index ? event.target.value : term,
                      ),
                    )
                  }
                />
              </label>
            ),
          )}
          <label>
            Page range
            <select aria-label="Index page range" value={rangeId} disabled={!!see.trim()} onChange={e=>setRangeId(e.target.value)}>
              <option value="">Current page</option>
              {rangeId && !ranges.some(r=>r.id===rangeId) && <option value={rangeId}>Unavailable bookmark</option>}
              {ranges.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label>
            Cross-reference
            <input
              aria-label="Index cross-reference"
              placeholder="For example: See also Trees"
              maxLength={200}
              value={see}
              disabled={!!rangeId}
              onChange={(event) => setSee(event.target.value)}
            />
          </label>
          <small>
            Bookmark a passage to index its page range. Leave Cross-reference empty to include page numbers. Insert an
            index through Table of contents → Index entries. Update fields
            refreshes the index.
          </small>
        </div>
        <footer>
          {error && <span role="alert">{error}</span>}
          {id && (
            <>
              <button
                type="button"
                onClick={() => {
                  dialog.current?.close();
                  onGo(id);
                }}
              >
                Go to
              </button>
              <button type="button" onClick={() => apply(true)}>
                Remove
              </button>
            </>
          )}
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={!validIndexEntry(value)}>
            {id ? "Apply" : "Mark"}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

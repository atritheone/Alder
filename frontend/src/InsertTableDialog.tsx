import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./word-processing.css";

export default function InsertTableDialog({
  onInsert,
  onClose,
}: {
  onInsert: (rows: number, columns: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState(3),
    [columns, setColumns] = useState(3);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      className="word-dialog"
      ref={dialog}
      aria-label="Insert table"
      onCancel={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onInsert(rows, columns);
        }}
      >
        <header>
          <strong>Insert table</strong>
          <button
            type="button"
            aria-label="Close insert table"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Rows
            <input
              aria-label="Table rows"
              type="number"
              min={1}
              max={100}
              step={1}
              required
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
            />
          </label>
          <label>
            Columns
            <input
              aria-label="Table columns"
              type="number"
              min={1}
              max={30}
              step={1}
              required
              value={columns}
              onChange={(e) => setColumns(Number(e.target.value))}
            />
          </label>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="accent" type="submit">
            Insert
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

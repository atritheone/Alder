import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { bulletMarkers, numberedMarkers } from "./listFormatting";
import "./word-processing.css";

export default function ListDialog({
  ordered,
  initial,
  onApply,
  onClose,
}: {
  ordered: boolean;
  initial: { order: number; listStyle: string; index: number };
  onApply: (listStyle: string, order: number, fromItem: boolean) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [marker, setMarker] = useState(initial.listStyle);
  const [order, setOrder] = useState(String(initial.order));
  const [fromItem, setFromItem] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const labels: Record<string, string> = {
    decimal: "1, 2, 3",
    "lower-alpha": "a, b, c",
    "upper-alpha": "A, B, C",
    "lower-roman": "i, ii, iii",
    "upper-roman": "I, II, III",
    disc: "Solid circle",
    circle: "Open circle",
    square: "Square",
  };
  return createPortal(
    <dialog
      className="word-dialog"
      aria-label="List"
      ref={dialog}
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(marker, Number(order), fromItem);
        }}
      >
        <header>
          <strong>List</strong>
          <button
            type="button"
            aria-label="Close list settings"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Markers
            <select
              aria-label="List markers"
              value={marker}
              onChange={(event) => setMarker(event.target.value)}
            >
              {(ordered ? numberedMarkers : bulletMarkers).map((value) => (
                <option key={value} value={value}>
                  {labels[value]}
                </option>
              ))}
            </select>
          </label>
          {ordered && (
            <label>
              Start at
              <input
                aria-label="List start"
                type="number"
                required
                min={1}
                max={100000}
                step={1}
                value={order}
                onChange={(event) => setOrder(event.target.value)}
              />
            </label>
          )}
          {initial.index > 0 && (
            <label>
              Apply to
              <select
                aria-label="List scope"
                value={String(fromItem)}
                onChange={(event) => setFromItem(event.target.value === "true")}
              >
                <option value="false">Whole list</option>
                <option value="true">From this item</option>
              </select>
            </label>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="accent" type="submit">
            Apply
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

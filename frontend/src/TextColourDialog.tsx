import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./word-processing.css";

export default function TextColourDialog({
  onApply,
  onClose,
}: {
  onApply: (colour: string | null) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [colour, setColour] = useState("#293f5e");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog"
      aria-labelledby="text-colour-title"
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(colour);
        }}
      >
        <header>
          <strong id="text-colour-title">Text colour</strong>
          <button
            type="button"
            aria-label="Close text colour"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Colour
            <input
              aria-label="Text colour"
              type="color"
              value={colour}
              onChange={(event) => setColour(event.target.value)}
            />
          </label>
        </div>
        <footer>
          <button type="button" onClick={() => onApply(null)}>
            Automatic
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="accent">
            Apply
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

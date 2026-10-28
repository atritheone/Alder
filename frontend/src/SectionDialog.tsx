import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { pageGeometry } from "./pageGeometry";
import type { SectionSettings } from "./sectionLayout";
import "./word-processing.css";

export default function SectionDialog({
  initial,
  editing,
  onApply,
  onClose,
  onRemove,
}: {
  initial: SectionSettings;
  editing: boolean;
  onApply: (value: SectionSettings) => void;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const invalid = pageGeometry(value.page).adjusted;
  return createPortal(
    <dialog
      className="word-dialog"
      aria-labelledby="section-title"
      ref={dialog}
      onCancel={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) onApply(value);
        }}
      >
        <header>
          <strong id="section-title">
            {editing ? "Section" : "Insert section break"}
          </strong>
          <button
            type="button"
            aria-label="Close section settings"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Start
            <select
              aria-label="Section start"
              value={value.kind}
              onChange={(e) =>
                setValue({
                  ...value,
                  kind: e.target.value as SectionSettings["kind"],
                })
              }
            >
              <option value="nextPage">Next page</option>
              <option value="oddPage">Next odd page</option>
              <option value="evenPage">Next even page</option>
            </select>
          </label>
          <label>
            Paper
            <select
              aria-label="Section paper"
              value={value.page.pageSize}
              onChange={(e) =>
                setValue({
                  ...value,
                  page: { ...value.page, pageSize: e.target.value },
                })
              }
            >
              {["A4", "A5", "Letter", "Legal", "6x9", "Custom"].map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
          </label>
          <label>
            Orientation
            <select
              aria-label="Section orientation"
              value={value.page.orientation}
              onChange={(e) =>
                setValue({
                  ...value,
                  page: { ...value.page, orientation: e.target.value },
                })
              }
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          {(
            [
              ...(value.page.pageSize === "Custom"
                ? [
                    ["pageWidthMm", "Width"],
                    ["pageHeightMm", "Height"],
                  ]
                : []),
              ["marginTopMm", "Top margin"],
              ["marginRightMm", "Right margin"],
              ["marginBottomMm", "Bottom margin"],
              ["marginLeftMm", "Left margin"],
              ["gutterMm", "Binding gutter"],
            ] as [keyof SectionSettings["page"], string][]
          ).map(([key, label]) => (
            <label key={key}>
              {label} (mm)
              <input
                aria-label={`Section ${label.toLowerCase()}`}
                type="number"
                min={key.startsWith("page") ? 50 : 0}
                max={
                  key.startsWith("page") ? 1000 : key === "gutterMm" ? 50 : 100
                }
                step="any"
                required
                value={
                  value.page[key] ??
                  (key === "pageWidthMm"
                    ? 210
                    : key === "pageHeightMm"
                      ? 297
                      : key === "gutterMm"
                        ? 0
                        : (value.page.marginMm ?? 22))
                }
                onChange={(e) =>
                  setValue({
                    ...value,
                    page: { ...value.page, [key]: Number(e.target.value) },
                  })
                }
              />
            </label>
          ))}
          {invalid && (
            <p role="alert">
              Leave at least 20 mm of writing space in each direction.
            </p>
          )}
        </div>
        <footer>
          {editing && onRemove && (
            <button type="button" onClick={onRemove}>
              Remove break
            </button>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={invalid}>
            {editing ? "Apply" : "Insert"}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

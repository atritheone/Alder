import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { pageGeometry } from "./pageGeometry";
import type { SectionSettings } from "./sectionLayout";
import { pageNumberFormats, type PageNumberFormat } from "./pageNumbering";
import "./word-processing.css";
import ColumnFields from "./ColumnFields";
import PageBorderFields from "./PageBorderFields";
import WatermarkFields from "./WatermarkFields";
import LineNumberFields from "./LineNumberFields";
import { validColumns } from "./columns";
import NoteOptionsFields from "./NoteOptionsFields";
import { type NoteOptions } from "./noteOptions";

export default function SectionDialog({
  initial,
  editing,
  onApply,
  onClose,
  onRemove,
  inheritedNotes,
}: {
  initial: SectionSettings;
  editing: boolean;
  onApply: (value: SectionSettings) => void;
  onClose: () => void;
  onRemove?: () => void;
  inheritedNotes: NoteOptions;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const invalid =
    pageGeometry(value.page).adjusted ||
    !validColumns(value.page.columns, value.page);
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
              <option value="continuous">Continuous</option>
              <option value="oddPage">Next odd page</option>
              <option value="evenPage">Next even page</option>
            </select>
          </label>
          <label>
            Page numbering
            <select
              aria-label="Section page numbering"
              value={value.numberingStart == null ? "continue" : "restart"}
              onChange={(e) =>
                setValue({
                  ...value,
                  numberingStart: e.target.value === "continue" ? null : 1,
                })
              }
            >
              <option value="continue">Continue from previous</option>
              <option value="restart">Restart</option>
            </select>
          </label>
          {value.numberingStart != null && (
            <label>
              Start at
              <input
                aria-label="Section starting page number"
                type="number"
                min={1}
                max={9999}
                step={1}
                required
                value={value.numberingStart}
                onChange={(e) =>
                  setValue({ ...value, numberingStart: Number(e.target.value) })
                }
              />
            </label>
          )}
          <label>
            Number format
            <select
              aria-label="Section number format"
              value={value.numberingFormat ?? ""}
              onChange={(e) =>
                setValue({
                  ...value,
                  numberingFormat: (e.target.value ||
                    null) as PageNumberFormat | null,
                })
              }
            >
              <option value="">Same as previous</option>
              {Object.entries(pageNumberFormats).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
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
            ] as [
              Exclude<
                keyof SectionSettings["page"],
                | "mirrorMargins"
                | "columns"
                | "pageBorder"
                | "watermark"
                | "lineNumbering"
              >,
              string,
            ][]
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
          <ColumnFields
            page={value.page}
            onChange={(columns) =>
              setValue({ ...value, page: { ...value.page, columns } })
            }
          />
          <details>
            <summary>Page border</summary>
            <PageBorderFields
              value={value.page.pageBorder}
              onChange={(pageBorder) =>
                setValue({ ...value, page: { ...value.page, pageBorder } })
              }
            />
          </details>
          <details>
            <summary>Watermark</summary>
            <WatermarkFields
              value={value.page.watermark}
              onChange={(watermark) =>
                setValue({ ...value, page: { ...value.page, watermark } })
              }
            />
          </details>
          <details>
            <summary>Line numbering</summary>
            <LineNumberFields
              value={value.page.lineNumbering}
              onChange={(lineNumbering) =>
                setValue({ ...value, page: { ...value.page, lineNumbering } })
              }
            />
          </details>
          <details>
            <summary>Notes</summary>
            <label>
              <input
                type="checkbox"
                checked={value.noteOptions == null}
                onChange={(event) =>
                  setValue({
                    ...value,
                    noteOptions: event.target.checked ? null : inheritedNotes,
                  })
                }
              />
              Same note settings as previous section
            </label>
            {value.noteOptions != null && (
              <NoteOptionsFields
                value={value.noteOptions}
                onChange={(noteOptions) => setValue({ ...value, noteOptions })}
              />
            )}
          </details>
          {invalid && (
            <p role="alert">
              Leave at least 20 mm of writing space in each column and between
              the top and bottom margins.
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

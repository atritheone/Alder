import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pageGeometry, type PageSettings } from "./pageGeometry";
import MeasurementInput from "./MeasurementInput";
import { useLayoutUnit } from "./layoutUnits";
import ColumnFields from "./ColumnFields";
import { validColumns } from "./columns";

export default function PageSetupDialog({
  initial,
  onApply,
  onClose,
  wholeDocument = false,
}: {
  initial: PageSettings;
  onApply: (settings: PageSettings, scope: "section" | "document") => void;
  onClose: () => void;
  wholeDocument?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initial),
    [unit] = useLayoutUnit();
  const [scope, setScope] = useState<"section" | "document">("section");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const invalid =
    pageGeometry(value).adjusted || !validColumns(value.columns, value);
  const fields: [keyof PageSettings, string, number, number][] = [
    ...(value.pageSize === "Custom"
      ? ([
          ["pageWidthMm", "Width", 50, 1000],
          ["pageHeightMm", "Height", 50, 1000],
        ] as [keyof PageSettings, string, number, number][])
      : []),
    ["marginTopMm", "Top margin", 0, 100],
    ["marginBottomMm", "Bottom margin", 0, 100],
    [
      "marginLeftMm",
      value.mirrorMargins ? "Inside margin" : "Left margin",
      0,
      100,
    ],
    [
      "marginRightMm",
      value.mirrorMargins ? "Outside margin" : "Right margin",
      0,
      100,
    ],
    ["gutterMm", "Binding gutter", 0, 50],
  ];
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog"
      aria-label="Page setup"
      onCancel={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) onApply(value, scope);
        }}
      >
        <header>
          <strong>Page setup</strong>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Apply to
            <select
              aria-label="Apply page settings to"
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
            >
              <option value="section">This section</option>
              {wholeDocument && (
                <option value="document">Whole document</option>
              )}
            </select>
          </label>
          <label>
            Paper
            <select
              aria-label="Paper"
              value={value.pageSize || "A4"}
              onChange={(e) => setValue({ ...value, pageSize: e.target.value })}
            >
              {["A4", "A5", "Letter", "Legal", "6x9", "Custom"].map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
          </label>
          <label>
            Orientation
            <select
              aria-label="Orientation"
              value={value.orientation || "portrait"}
              onChange={(e) =>
                setValue({ ...value, orientation: e.target.value })
              }
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label>
            Margins
            <select
              aria-label="Margin preset"
              value=""
              onChange={(e) => {
                const margin = Number(e.target.value);
                setValue({
                  ...value,
                  marginTopMm: margin,
                  marginBottomMm: margin,
                  marginLeftMm: margin,
                  marginRightMm: margin,
                });
              }}
            >
              <option value="">Custom</option>
              <option value="12.7">Narrow</option>
              <option value="25.4">Normal</option>
              <option value="50.8">Wide</option>
            </select>
          </label>
          {fields.map(([key, label, min, max]) => (
            <label key={key}>
              {label} ({unit})
              <MeasurementInput
                label={label}
                value={
                  (Number(
                    value[key] ??
                      (key === "gutterMm" ? 0 : (value.marginMm ?? 22)),
                  ) *
                    72) /
                  25.4
                }
                min={(min * 72) / 25.4}
                max={(max * 72) / 25.4}
                onChange={(points) => {
                  if (points != null)
                    setValue({ ...value, [key]: (points * 25.4) / 72 });
                }}
              />
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={!!value.mirrorMargins}
              onChange={(e) =>
                setValue({ ...value, mirrorMargins: e.target.checked })
              }
            />
            Mirror margins
          </label>
          <ColumnFields
            page={value}
            onChange={(columns) => setValue({ ...value, columns })}
          />
          {invalid && (
            <p role="alert">
              Leave at least 20 mm of writing space in each column and between
              the top and bottom margins.
            </p>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={invalid}>
            Apply
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

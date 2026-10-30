import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  type selectedTableProperties,
  type TableAppearance,
} from "./tableFormatting";
import "./word-processing.css";

export default function TableDialog({
  initial,
  onApply,
  onClose,
}: {
  initial: NonNullable<ReturnType<typeof selectedTableProperties>>;
  onApply: (values: TableAppearance) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [changes, setChanges] = useState<TableAppearance>({
    table: {},
    cells: {},
    rows: {},
  });
  const change = (group: "table" | "cells" | "rows", key: string, value: any) =>
    setChanges((previous) => ({
      ...previous,
      [group]: { ...previous[group], [key]: value },
    }));
  const value = (group: "table" | "cells" | "rows", key: string) =>
    Object.hasOwn(changes[group], key)
      ? changes[group][key]
      : initial[group][key];
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const number = (
    group: "cells" | "rows",
    key: string,
    label: string,
    max: number,
  ) => (
    <label key={key}>
      {label}
      <input
        aria-label={label}
        type="number"
        min={0}
        max={max}
        step="any"
        value={value(group, key) ?? ""}
        placeholder={initial[group][key] === undefined ? "Mixed" : "Automatic"}
        onChange={(event) =>
          change(
            group,
            key,
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
      />
    </label>
  );
  return createPortal(
    <dialog
      className="word-dialog"
      aria-label="Table properties"
      ref={dialog}
      onCancel={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onApply(changes);
        }}
      >
        <header>
          <strong>Table properties</strong>
          <button
            type="button"
            aria-label="Close table properties"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Table alignment
            <select
              aria-label="Table alignment"
              value={value("table", "align")}
              onChange={(event) => change("table", "align", event.target.value)}
            >
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </label>
          <strong>Selected cells</strong>
          <label>
            Vertical alignment
            <select
              aria-label="Cell vertical alignment"
              value={value("cells", "verticalAlign") ?? ""}
              onChange={(event) =>
                change("cells", "verticalAlign", event.target.value || null)
              }
            >
              <option value="">Mixed / automatic</option>
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
          {(["Top", "Bottom", "Left", "Right"] as const).map((side) =>
            number("cells", `padding${side}`, `${side} padding (pt)`, 144),
          )}
          {number("cells", "borderWidth", "Border width (pt)", 12)}
          {(
            [
              ["borderColor", "Border colour"],
              ["background", "Shading"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <span className="table-colour-field">
                <input
                  aria-label={label}
                  type="color"
                  value={value("cells", key) || "#ffffff"}
                  onChange={(event) => change("cells", key, event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => change("cells", key, null)}
                >
                  Reset
                </button>
              </span>
            </label>
          ))}
          <strong>Selected rows and columns</strong>
          <label>
            Row breaks
            <select
              aria-label="Row breaks"
              value={
                value("rows", "allowSplit") === undefined
                  ? "mixed"
                  : String(value("rows", "allowSplit"))
              }
              onChange={(event) =>
                change("rows", "allowSplit", event.target.value === "true")
              }
            >
              {value("rows", "allowSplit") === undefined && (
                <option value="mixed" disabled>
                  Mixed
                </option>
              )}
              <option value="false">Keep row together</option>
              <option value="true">Allow across pages</option>
            </select>
          </label>
          {number("rows", "minHeight", "Minimum row height (pt)", 1440)}
          <label>
            Column width (mm)
            <input
              aria-label="Column width (mm)"
              type="number"
              min={6.62}
              max={2645.84}
              step="any"
              placeholder="Unchanged"
              defaultValue={
                initial.columnWidth
                  ? Math.max(
                      6.62,
                      Math.round(((initial.columnWidth * 25.4) / 96) * 100) /
                        100,
                    )
                  : ""
              }
              onChange={(event) =>
                setChanges((previous) => ({
                  ...previous,
                  columnWidth:
                    event.target.value === ""
                      ? undefined
                      : Math.round((Number(event.target.value) * 96) / 25.4),
                }))
              }
            />
          </label>
          <small>
            Changes apply to the selected cells, rows and columns. Row height
            grows to keep all content visible. Rows taller than a page must
            split.
          </small>
          {!initial.parallelRows && (
            <small>
              This table contains objects or aligned containers that cannot yet
              flow independently across pages. The row-break choice is retained for Word.
            </small>
          )}
        </div>
        <footer>
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

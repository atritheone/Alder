import { useEffect, useState } from "react";
import type { PageSettings } from "./pageGeometry";
import { validColumns, type Columns } from "./columns";

/** Shared document/section controls. Incomplete numeric input stays local. */
export default function ColumnFields({
  page,
  onChange,
  rowClass = "",
}: {
  page: PageSettings;
  onChange: (value: Columns) => void;
  rowClass?: string;
}) {
  const value = page.columns || { count: 1, gapMm: 8 };
  const [gap, setGap] = useState(String(value.gapMm));
  useEffect(() => setGap(String(value.gapMm)), [value.gapMm]);
  return (
    <>
      <label className={rowClass}>
        Columns
        <select
          aria-label="Columns"
          value={value.count}
          onChange={(e) =>
            onChange({ ...value, count: Number(e.target.value) })
          }
        >
          {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
            <option
              key={count}
              value={count}
              disabled={!validColumns({ ...value, count }, page)}
            >
              {count}
            </option>
          ))}
        </select>
      </label>
      {value.count > 1 && (
        <>
          <label className={rowClass}>
            Gap (mm)
            <input
              aria-label="Column gap"
              type="number"
              min={0}
              max={100}
              step="any"
              value={gap}
              onChange={(e) => {
                setGap(e.target.value);
                const next = { ...value, gapMm: e.currentTarget.valueAsNumber };
                if (e.currentTarget.validity.valid && validColumns(next, page))
                  onChange(next);
              }}
              onBlur={() => setGap(String(value.gapMm))}
            />
          </label>
          <label className={rowClass}>
            Line between columns
            <input
              aria-label="Line between columns"
              type="checkbox"
              checked={!!value.separator}
              onChange={(e) =>
                onChange({ ...value, separator: e.target.checked })
              }
            />
          </label>
        </>
      )}
    </>
  );
}

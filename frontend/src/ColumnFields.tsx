import { pageGeometry, type PageSettings } from "./pageGeometry";
import { validColumns, type Columns } from "./columns";
import MeasurementInput from "./MeasurementInput";
import { useLayoutUnit } from "./layoutUnits";

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
  const [unit] = useLayoutUnit();
  const geometry = pageGeometry(page);
  const maximumGap = value.count>1 ? Math.max(0,Math.min(100,
    (geometry.width-geometry.margins.left-geometry.margins.right-value.count*20)/(value.count-1))) : 100;
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
            Gap ({unit})
            <MeasurementInput
              label="Column gap"
              min={0}
              max={maximumGap*72/25.4}
              value={value.gapMm*72/25.4}
              onChange={points => {
                if(points == null)return;
                const next = { ...value, gapMm: points*25.4/72 };
                if (validColumns(next, page))
                  onChange(next);
              }}
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

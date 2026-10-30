import {
  defaultPageBorder,
  validPageBorder,
  type PageBorder,
} from "./pageBorder";
export default function PageBorderFields({
  value,
  onChange,
  rowClass,
}: {
  value?: PageBorder | null;
  onChange: (value: PageBorder | null) => void;
  rowClass?: string;
}) {
  const change = (patch: Partial<PageBorder>) => {
    const next = { ...defaultPageBorder, ...value, ...patch };
    if (validPageBorder(next)) onChange(next);
  };
  return (
    <>
      <label className={rowClass}>
        Page border
        <select
          aria-label="Page border"
          value={value?.style || "none"}
          onChange={(e) =>
            e.target.value === "none"
              ? onChange(null)
              : change({ style: e.target.value as PageBorder["style"] })
          }
        >
          <option value="none">None</option>
          <option value="single">Single</option>
          <option value="double">Double</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </label>
      {value && (
        <>
          <label className={rowClass}>
            Border width (pt)
            <input
              aria-label="Page border width (pt)"
              type="number"
              min={0.25}
              max={6}
              step={0.125}
              value={value.width}
              onChange={(e) => change({ width: Number(e.target.value) })}
            />
          </label>
          <label className={rowClass}>
            Border colour
            <input
              aria-label="Page border colour"
              type="color"
              value={value.color}
              onChange={(e) => change({ color: e.target.value })}
            />
          </label>
          <label className={rowClass}>
            Distance from page edge (pt)
            <input
              aria-label="Border distance from page edge (pt)"
              type="number"
              min={0}
              max={31}
              step={1}
              value={value.distance}
              onChange={(e) => change({ distance: Number(e.target.value) })}
            />
          </label>
          <label className={rowClass}>
            Show on
            <select
              aria-label="Show page border on"
              value={value.display}
              onChange={(e) =>
                change({ display: e.target.value as PageBorder["display"] })
              }
            >
              <option value="allPages">All pages</option>
              <option value="firstPage">First page of section</option>
              <option value="notFirstPage">Except first page of section</option>
            </select>
          </label>
        </>
      )}
    </>
  );
}

import type { StyleProperties } from "./types";

export default function ParagraphAppearanceFields({
  value,
  onChange,
}: {
  value: StyleProperties;
  onChange: (patch: Partial<StyleProperties>) => void;
}) {
  return (
    <fieldset className="paragraph-appearance-fields">
      <legend>Borders and shading</legend>
      {(
        [
          ["paragraphBackground", "Paragraph shading"],
          ["paragraphBorderColor", "Paragraph border colour"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <span className="table-colour-field">
            <input
              type="color"
              aria-label={label}
              value={value[key]?.startsWith("#") ? value[key] : "#ffffff"}
              onChange={(e) => onChange({ [key]: e.target.value })}
            />
            <button
              type="button"
              onClick={() =>
                onChange(
                  key === "paragraphBorderColor"
                    ? { paragraphBorderWidth: 0 }
                    : { [key]: "transparent" },
                )
              }
            >
              None
            </button>
            <button type="button" onClick={() => onChange({ [key]: null })}>
              Inherit
            </button>
          </span>
        </label>
      ))}
      {(
        [
          ["paragraphBorderWidth", "Paragraph border width (pt)", 12],
          ["paragraphPadding", "Paragraph padding (pt)", 31],
        ] as const
      ).map(([key, label, max]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            aria-label={label}
            min={0}
            max={max}
            step={key === "paragraphPadding" ? 1 : 0.25}
            placeholder="Inherited / mixed"
            value={value[key] ?? ""}
            onChange={(e) =>
              onChange({
                [key]: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </label>
      ))}
    </fieldset>
  );
}

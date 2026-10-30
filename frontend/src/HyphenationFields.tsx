import type { StyleProperties } from "./types";
export default function HyphenationFields({
  value,
  onChange,
}: {
  value: StyleProperties;
  onChange: (patch: Partial<StyleProperties>) => void;
}) {
  return (
    <details className="word-dialog-fields">
      <summary>Language and direction</summary>
      <label>
        Paragraph direction
        <select
          aria-label="Paragraph direction"
          value={value.textDirection || ""}
          onChange={(event) =>
            onChange({
              textDirection: (event.target.value as "ltr" | "rtl") || null,
            })
          }
        >
          <option value="">Inherited / mixed</option>
          <option value="ltr">Left to right</option>
          <option value="rtl">Right to left</option>
        </select>
      </label>
      <label>
        Paragraph language
        <input
          aria-label="Paragraph language"
          placeholder="Document language"
          maxLength={40}
          pattern="[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*"
          value={value.textLanguage || ""}
          onChange={(e) => onChange({ textLanguage: e.target.value || null })}
        />
      </label>
      <small>
        Use a language tag, such as en-GB, en-US, de or fr. Blank uses the
        inherited language.
      </small>
      <label>
        Automatic hyphenation
        <select
          aria-label="Automatic hyphenation"
          value={value.hyphenation == null ? "" : String(value.hyphenation)}
          onChange={(e) =>
            onChange({
              hyphenation:
                e.target.value === "" ? null : e.target.value === "true",
            })
          }
        >
          <option value="">Inherited / mixed</option>
          <option value="true">On</option>
          <option value="false">Off</option>
        </select>
      </label>
    </details>
  );
}

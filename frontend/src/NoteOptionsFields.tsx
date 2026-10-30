import { noteOptions, type NoteOptions } from "./noteOptions";
import { pageNumberFormats, type PageNumberFormat } from "./pageNumbering";
export default function NoteOptionsFields({
  value,
  onChange,
}: {
  value?: NoteOptions;
  onChange: (value: NoteOptions) => void;
}) {
  const options = noteOptions(value);
  const change = (kind: keyof NoteOptions, patch: Record<string, unknown>) =>
    onChange({ ...options, [kind]: { ...options[kind], ...patch } });
  return (
    <>
      {(["footnote", "endnote"] as const).map((kind) => {
        const label = kind === "footnote" ? "Footnotes" : "Endnotes",
          row = options[kind];
        return (
          <details key={kind}>
            <summary>{label}</summary>
            <label className="settings-row">
              Number format
              <select
                aria-label={`${label} number format`}
                value={row.format}
                onChange={(event) =>
                  change(kind, {
                    format: event.target.value as PageNumberFormat,
                  })
                }
              >
                {Object.entries(pageNumberFormats).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-row">
              Start at
              <input
                aria-label={`${label} start at`}
                type="number"
                min="1"
                max="32767"
                value={row.start}
                onChange={(event) => {
                  const start = Number(event.target.value);
                  if (Number.isInteger(start) && start >= 1 && start <= 32767)
                    change(kind, { start });
                }}
              />
            </label>
            <label className="settings-row">
              Numbering
              <select
                aria-label={`${label} numbering`}
                value={row.restart}
                onChange={(event) =>
                  change(kind, { restart: event.target.value })
                }
              >
                <option value="continuous">Continuous</option>
                <option value="section">Restart each section</option>
                {kind === "footnote" && (
                  <option value="page">Restart each page</option>
                )}
              </select>
            </label>
            {kind === "footnote" && (
              <label className="settings-row">
                Placement
                <select
                  aria-label="Footnotes placement"
                  value={options.footnote.placement}
                  onChange={(event) =>
                    change(kind, { placement: event.target.value })
                  }
                >
                  <option value="pageBottom">Bottom of page</option>
                  <option value="beneathText">Below text</option>
                </select>
              </label>
            )}
          </details>
        );
      })}
    </>
  );
}

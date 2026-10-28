import { useMemo } from "react";
import { useStoredPreference } from "./useStoredPreference";
import {
  parseTextReplacements,
  typingPreferenceKeys,
  type TextReplacement,
} from "./typingAssistance";

export function useTypingPreferences() {
  const [quotes] = useStoredPreference(
    typingPreferenceKeys.smartQuotes,
    "false",
  );
  const [dashes] = useStoredPreference(
    typingPreferenceKeys.smartDashes,
    "false",
  );
  const [lists] = useStoredPreference(
    typingPreferenceKeys.automaticLists,
    "false",
  );
  const [replacements] = useStoredPreference(
    typingPreferenceKeys.replacements,
    "[]",
  );
  return useMemo(
    () => ({
      smartQuotes: quotes === "true",
      smartDashes: dashes === "true",
      automaticLists: lists === "true",
      replacements: parseTextReplacements(replacements),
    }),
    [quotes, dashes, lists, replacements],
  );
}
function Toggle({
  name,
  label,
}: {
  name: keyof Omit<typeof typingPreferenceKeys, "replacements">;
  label: string;
}) {
  const [value, setValue] = useStoredPreference(
    typingPreferenceKeys[name],
    "false",
  );
  return (
    <label className="settings-row">
      {label}
      <input
        type="checkbox"
        checked={value === "true"}
        onChange={(event) => setValue(String(event.target.checked))}
      />
    </label>
  );
}
export default function TypingSettings() {
  const [value, setValue] = useStoredPreference(
    typingPreferenceKeys.replacements,
    "[]",
  );
  let entries: TextReplacement[];
  try {
    const parsed = JSON.parse(value);
    entries = Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            typeof item?.from === "string" && typeof item?.to === "string",
        )
      : [];
  } catch {
    entries = [];
  }
  const edit = (index: number, key: keyof TextReplacement, text: string) =>
    setValue(
      JSON.stringify(
        entries.map((entry, at) =>
          at === index ? { ...entry, [key]: text } : entry,
        ),
      ),
    );
  return (
    <section className="settings-section">
      <h3>While typing</h3>
      <Toggle name="smartQuotes" label="Smart quotes" />
      <Toggle
        name="smartDashes"
        label="Replace double hyphens with an em dash"
      />
      <Toggle name="automaticLists" label="Start lists automatically" />
      <details>
        <summary>Text replacements</summary>
        {entries.map((entry, index) => (
          <div className="typing-replacement" key={index}>
            <label>
              Replace
              <input
                aria-label={`Replace word ${index + 1}`}
                maxLength={40}
                value={entry.from}
                onChange={(event) => edit(index, "from", event.target.value)}
              />
            </label>
            <label>
              With
              <input
                aria-label={`Replacement ${index + 1}`}
                maxLength={200}
                value={entry.to}
                onChange={(event) => edit(index, "to", event.target.value)}
              />
            </label>
            <button
              aria-label={`Remove replacement ${index + 1}`}
              onClick={() =>
                setValue(
                  JSON.stringify(entries.filter((_, at) => at !== index)),
                )
              }
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            setValue(JSON.stringify([...entries, { from: "", to: "" }]))
          }
        >
          Add replacement
        </button>
        <p className="settings-note">
          Replace a whole word after a space or punctuation. Empty entries are
          inactive. Backspace immediately after a change restores what you
          typed.
        </p>
      </details>
    </section>
  );
}

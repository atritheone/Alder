import { useStoredPreference } from "./useStoredPreference";

export function useTextPreferences() {
  const [wrap, setWrap] = useStoredPreference("alder.txt.wrap", "true");
  const [numbers, setNumbers] = useStoredPreference(
    "alder.txt.numbers",
    "true",
  );
  const [whitespace, setWhitespace] = useStoredPreference(
    "alder.txt.whitespace",
    "false",
  );
  const [fontSize, setFontSize] = useStoredPreference("alder.txt.fontSize", "");
  const [tabSize, setTabSize] = useStoredPreference("alder.txt.tabSize", "4");
  const [completion, setCompletion] = useStoredPreference(
    "alder.txt.completion",
    "true",
  );
  const [threshold, setThreshold] = useStoredPreference(
    "alder.txt.threshold",
    "3",
  );
  const [font, setFont] = useStoredPreference("alder.txt.font", "");
  const [wholeWord, setWholeWord] = useStoredPreference(
    "alder.txt.wholeWord",
    "true",
  );
  const [caseSensitive, setCaseSensitive] = useStoredPreference(
    "alder.txt.caseSensitive",
    "false",
  );
  const [autoPairs, setAutoPairs] = useStoredPreference(
    "alder.txt.autoPairs",
    "false",
  );
  const [useTabs, setUseTabs] = useStoredPreference(
    "alder.txt.useTabs",
    "true",
  );
  const [autoIndent, setAutoIndent] = useStoredPreference(
    "alder.txt.autoIndent",
    "false",
  );
  const [restoreSession, setRestoreSession] = useStoredPreference(
    "alder.txt.restoreSession",
    "true",
  );
  return {
    wrap: wrap === "true",
    setWrap: (value: boolean) => setWrap(String(value)),
    numbers: numbers === "true",
    setNumbers: (value: boolean) => setNumbers(String(value)),
    whitespace: whitespace === "true",
    setWhitespace: (value: boolean) => setWhitespace(String(value)),
    fontSize: Math.max(8, Math.min(96, Number(fontSize) || 16)),
    inheritFontSize: !fontSize,
    setFontSize: (value: number) => setFontSize(String(value)),
    tabSize: Math.max(1, Math.min(16, Number(tabSize) || 4)),
    setTabSize: (value: number) => setTabSize(String(value)),
    completion: completion === "true",
    setCompletion: (value: boolean) => setCompletion(String(value)),
    threshold: Math.max(1, Math.min(20, Number(threshold) || 3)),
    setThreshold: (value: number) => setThreshold(String(value)),
    font,
    setFont,
    wholeWord: wholeWord === "true",
    setWholeWord: (value: boolean) => setWholeWord(String(value)),
    caseSensitive: caseSensitive === "true",
    setCaseSensitive: (value: boolean) => setCaseSensitive(String(value)),
    autoPairs: autoPairs === "true",
    setAutoPairs: (value: boolean) => setAutoPairs(String(value)),
    useTabs: useTabs === "true",
    setUseTabs: (value: boolean) => setUseTabs(String(value)),
    autoIndent: autoIndent === "true",
    setAutoIndent: (value: boolean) => setAutoIndent(String(value)),
    restoreSession: restoreSession !== "false",
    setRestoreSession: (value: boolean) => setRestoreSession(String(value)),
  };
}
export default function TextEditorSettings() {
  const p = useTextPreferences();
  return (
    <div>
      <h3>Text editor</h3>
      <p>Preferences for TXT files in Write mode.</p>
      {(
        [
          ["Word wrap", p.wrap, p.setWrap],
          ["Line numbers", p.numbers, p.setNumbers],
          ["Show whitespace", p.whitespace, p.setWhitespace],
          ["Automatic word completion", p.completion, p.setCompletion],
        ] as const
      ).map(([label, value, set]) => (
        <label className="settings-row" key={label}>
          {label}
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => set(e.target.checked)}
          />
        </label>
      ))}
      <label className="settings-row">
        Font family
        <input value={p.font} onChange={(e) => p.setFont(e.target.value)} />
      </label>
      <label className="settings-row">
        Font size
        <input
          type="number"
          min={8}
          max={48}
          value={p.fontSize}
          onChange={(e) => p.setFontSize(Number(e.target.value))}
        />
      </label>
      <label className="settings-row">
        Tab width
        <input
          type="number"
          min={1}
          max={16}
          value={p.tabSize}
          onChange={(e) => p.setTabSize(Number(e.target.value))}
        />
      </label>
      <label className="settings-row">
        Suggest after characters
        <input
          type="number"
          min={1}
          max={20}
          value={p.threshold}
          onChange={(e) => p.setThreshold(Number(e.target.value))}
        />
      </label>
      <label className="settings-row">
        Highlight whole words only
        <input
          type="checkbox"
          checked={p.wholeWord}
          onChange={(e) => p.setWholeWord(e.target.checked)}
        />
      </label>
      <label className="settings-row">
        Case-sensitive occurrence highlights
        <input
          type="checkbox"
          checked={p.caseSensitive}
          onChange={(e) => p.setCaseSensitive(e.target.checked)}
        />
      </label>
      <label className="settings-row">
        Automatically close brackets and quotes
        <input
          type="checkbox"
          checked={p.autoPairs}
          onChange={(e) => p.setAutoPairs(e.target.checked)}
        />
      </label>
      <label className="settings-row">
        Indent with literal tabs
        <input
          type="checkbox"
          checked={p.useTabs}
          onChange={(e) => p.setUseTabs(e.target.checked)}
        />
      </label>
      <label className="settings-row">
        Continue previous line indentation
        <input
          type="checkbox"
          checked={p.autoIndent}
          onChange={(e) => p.setAutoIndent(e.target.checked)}
        />
      </label>
      <label className="settings-row">
        Restore previous TXT tabs when opening a workspace
        <input
          type="checkbox"
          checked={p.restoreSession}
          onChange={(e) => p.setRestoreSession(e.target.checked)}
        />
      </label>
    </div>
  );
}

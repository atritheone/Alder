import { useReadReferences } from "./useReadReferences";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Project } from "./types";
import SpeechOptions, { DEFAULT_SPEECH_OPTIONS } from "./SpeechOptions";
import RulesManager from "./RulesManager";
import { useInstalledFonts } from "./useInstalledFonts";
import { usePlaybackSettings } from "./usePlaybackSettings";
import { useStoredPreference } from "./useStoredPreference";
import "./settings-window.css";
import TypingSettings from "./TypingSettings";
import { pageGeometry } from "./pageGeometry";
import { pageNumberFormats, type PageNumberFormat } from "./pageNumbering";
import ColumnFields from "./ColumnFields";
import PageBorderFields from './PageBorderFields';
import WatermarkFields from './WatermarkFields';
import LineNumberFields from './LineNumberFields';
import { validColumns } from "./columns";
import NoteOptionsFields from './NoteOptionsFields';
import { stationeryPrintHint } from './stationery';

const categories = [
  "Appearance",
  "Writing",
  "Page Layout",
  "Publication",
  "Speech",
  "Language Rules",
] as const;
export type SettingsCategory = (typeof categories)[number];
type Props = {
  category: SettingsCategory;
  onCategory: (category: SettingsCategory) => void;
  project: Project | null;
  onChange: (fn: (project: Project) => void) => void;
  uiScale: string;
  onScale: (scale: string) => void;
  onClose: () => void;
  onManage: (panel: string) => void;
  onRunningMatter: () => void;
  saveState: string;
  saveError: string;
};
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
function NumberSetting({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  // Keep incomplete input while typing (e.g. the "1" on the way to a 14 pt font).
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (
          e.currentTarget.validity.valid &&
          Number.isFinite(e.currentTarget.valueAsNumber)
        )
          onChange(e.currentTarget.valueAsNumber);
      }}
      onBlur={() => setText(String(value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function Playback({
  scope,
  title,
}: {
  scope: "reading" | "sandbox" | "narration";
  title: string;
}) {
  const { speed, setSpeed, volume, setVolume } = usePlaybackSettings(scope);
  return (
    <Section title={title}>
      <label className="settings-row">
        Speed
        <NumberSetting
          label={`${title} speed`}
          min={0.25}
          max={3}
          step={0.01}
          value={speed}
          onChange={setSpeed}
        />
      </label>
      <label className="settings-row">
        Volume
        <input
          aria-label={`${title} volume`}
          type="range"
          min={0}
          max={4}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(e.currentTarget.valueAsNumber)}
        />
      </label>
    </Section>
  );
}

export default function SettingsWindow(p: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const fonts = useInstalledFonts(p.project?.settings.fontFamily);
  const [rememberPosition, setRememberPosition] = useStoredPreference(
    "alder.rememberDocumentPosition",
    "true",
  );
  const [readReferences, setReadReferences] = useReadReferences();
  const [writeChecks, setWriteChecks] = useStoredPreference(
    "alder.writeSpellcheck",
    "true",
  );
  const [sandboxChecks, setSandboxChecks] = useStoredPreference(
    "alder.sandboxSpellcheck",
    "true",
  );
  const [audioFormat, setAudioFormat] = useStoredPreference(
    "alder.narrationFormat",
    "wav",
  );
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = 0;
    setError("");
  }, [p.category]);
  const setting = (key: string, value: unknown) => {
    let repairedMargins: Record<string, number> | undefined;
    if (
      /^(pageSize|orientation|pageWidthMm|pageHeightMm|margin.*Mm|gutterMm)$/.test(
        key,
      )
    ) {
      const previous = pageGeometry(p.project?.settings);
      if (previous.adjusted)
        repairedMargins = {
          marginTopMm: previous.margins.top,
          marginRightMm: previous.margins.right,
          marginBottomMm: previous.margins.bottom,
          marginLeftMm: previous.margins.left,
          gutterMm: 0,
        };
      const candidate = {
        ...p.project?.settings,
        ...repairedMargins,
        [key]: value,
      };
      if (pageGeometry(candidate).adjusted) {
        setError(
          "Page margins must leave at least 20 mm of writing space in each direction. Reduce the margins before choosing a smaller page.",
        );
        return;
      }
      if (!validColumns(candidate.columns, candidate)) {
        setError(
          "Each column needs at least 20 mm of writing space. Reduce the column count or gap before choosing smaller page dimensions.",
        );
        return;
      }
      setError("");
    }
    p.onChange((project) => {
      if (repairedMargins) Object.assign(project.settings, repairedMargins);
      project.settings[key] = value;
    });
  };
  const text = (key: string, label: string, multiline = false) => (
    <label className="settings-row" key={key}>
      {label}
      {multiline ? (
        <textarea
          aria-label={label}
          value={p.project?.settings[key] ?? ""}
          onChange={(e) => setting(key, e.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          value={p.project?.settings[key] ?? ""}
          onChange={(e) => setting(key, e.target.value)}
        />
      )}
    </label>
  );
  const number = (
    key: string,
    label: string,
    min: number,
    max: number,
    step: number,
    fallback: number,
  ) => (
    <label className="settings-row">
      {label}
      <NumberSetting
        label={label}
        min={min}
        max={max}
        step={step}
        value={p.project?.settings[key] ?? fallback}
        onChange={(value) => setting(key, value)}
      />
    </label>
  );
  const check = (key: string, label: string, fallback = false) => (
    <label className="settings-row">
      {label}
      <input
        aria-label={label}
        type="checkbox"
        checked={p.project?.settings[key] ?? fallback}
        onChange={(e) => setting(key, e.target.checked)}
      />
    </label>
  );
  const select = (
    key: string,
    label: string,
    choices: string[],
    fallback: string,
  ) => (
    <label className="settings-row">
      {label}
      <select
        aria-label={label}
        value={p.project?.settings[key] ?? fallback}
        onChange={(e) => setting(key, e.target.value)}
      >
        {choices.map((value) => (
          <option key={value} value={value}>
            {value === "portrait"
              ? "Portrait"
              : value === "landscape"
                ? "Landscape"
                : value}
          </option>
        ))}
      </select>
    </label>
  );
  return createPortal(
    <dialog
      ref={dialog}
      className="settings-window"
      aria-labelledby="settings-title"
      onCancel={(e) => {
        e.preventDefault();
        p.onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <h2 id="settings-title">Settings</h2>
        <button aria-label="Close settings" onClick={p.onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="settings-body">
        <nav
          role="tablist"
          aria-label="Settings categories"
          aria-orientation="vertical"
        >
          {categories.map((category, index) => (
            <button
              key={category}
              role="tab"
              id={`settings-tab-${index}`}
              aria-controls="settings-content"
              aria-selected={p.category === category}
              tabIndex={p.category === category ? 0 : -1}
              onClick={() => p.onCategory(category)}
              onKeyDown={(e) => {
                const next =
                  e.key === "ArrowDown"
                    ? (index + 1) % categories.length
                    : e.key === "ArrowUp"
                      ? (index + categories.length - 1) % categories.length
                      : e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? categories.length - 1
                          : -1;
                if (next >= 0) {
                  e.preventDefault();
                  p.onCategory(categories[next]);
                  document.getElementById(`settings-tab-${next}`)?.focus();
                }
              }}
            >
              {category}
            </button>
          ))}
        </nav>
        <div
          ref={content}
          className="settings-content"
          id="settings-content"
          role="tabpanel"
          aria-labelledby={`settings-tab-${categories.indexOf(p.category)}`}
          tabIndex={0}
        >
          {p.category === "Appearance" && (
            <>
              <Section title="Interface">
                <label className="settings-row">
                  UI Scale
                  <select
                    aria-label="UI Scale"
                    value={p.uiScale}
                    onChange={(e) => p.onScale(e.target.value)}
                  >
                    {Array.from({ length: 11 }, (_, i) => (i + 5) / 10).map(
                      (scale) => (
                        <option key={scale} value={String(scale)}>
                          {Math.round(scale * 100)}%
                          {scale === 1 ? " (default)" : ""}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </Section>
            </>
          )}
          {p.category === "Writing" && (
            <>
              <Section title="Documents">
                <label className="settings-row">
                  Remember document position
                  <input
                    type="checkbox"
                    checked={rememberPosition !== "false"}
                    onChange={(e) =>
                      setRememberPosition(String(e.target.checked))
                    }
                  />
                </label>
              </Section>
              <TypingSettings />
              <Section title="Spelling & grammar">
                <label className="settings-row">
                  Check writing
                  <input
                    type="checkbox"
                    checked={writeChecks !== "false"}
                    onChange={(e) => setWriteChecks(String(e.target.checked))}
                  />
                </label>
                <label className="settings-row">
                  Check sandbox
                  <input
                    type="checkbox"
                    checked={sandboxChecks !== "false"}
                    onChange={(e) => setSandboxChecks(String(e.target.checked))}
                  />
                </label>
                <p className="settings-note">
                  Spelling and grammar marks are hidden during speech playback.
                </p>
              </Section>
              <fieldset disabled={!p.project}>
                <Section title="Document typography">
                  {select("fontFamily", "Body font", fonts, "Cambria")}
                  {number("fontSize", "Body size (pt)", 8, 32, 1, 12)}
                  {number("lineHeight", "Line height", 1, 3, 0.1, 1.6)}
                  <button onClick={() => p.onManage("styles")}>
                    Manage styles…
                  </button>
                </Section>
              </fieldset>
            </>
          )}
          {p.category === "Page Layout" && (
            <>
              <fieldset disabled={!p.project}>
                <Section title="Page">
                  {p.project?.settings.stationeryPreset && <>
                    <p className="quiet">{stationeryPrintHint(p.project.settings.stationeryPreset)}</p>
                    <label className="settings-row"><span>Check stationery fit</span><input type="checkbox" checked onChange={() => p.onChange(project => {project.settings.stationeryPreset = null;})} /></label>
                  </>}
                  {select(
                    "pageSize",
                    "Page size",
                    ["A4", "A5", "Letter", "Legal", "6x9", "Custom"],
                    "A4",
                  )}
                  {p.project?.settings.pageSize === "Custom" && (
                    <>
                      {number(
                        "pageWidthMm",
                        "Paper width (mm)",
                        50,
                        1000,
                        0.1,
                        210,
                      )}
                      {number(
                        "pageHeightMm",
                        "Paper height (mm)",
                        50,
                        1000,
                        0.1,
                        297,
                      )}
                    </>
                  )}
                  {select(
                    "orientation",
                    "Orientation",
                    ["portrait", "landscape"],
                    "portrait",
                  )}
                </Section>
                <Section title="Margins">
                  {check("mirrorMargins", "Mirror margins")}
                  {(["Top", "Bottom", "Left", "Right"] as const).map((edge) => (
                    <div key={edge}>
                      {number(
                        `margin${edge}Mm`,
                        `${p.project?.settings.mirrorMargins && edge === "Left" ? "Inside" : p.project?.settings.mirrorMargins && edge === "Right" ? "Outside" : edge} (mm)`,
                        0,
                        100,
                        0.1,
                        p.project?.settings.marginMm ?? 22,
                      )}
                    </div>
                  ))}
                  {number(
                    "gutterMm",
                    p.project?.settings.mirrorMargins
                      ? "Inside binding gutter (mm)"
                      : "Left binding gutter (mm)",
                    0,
                    50,
                    0.1,
                    0,
                  )}
                  {p.project && pageGeometry(p.project.settings).adjusted && (
                    <p role="status">
                      These older margins are reduced to keep a 20 mm writing
                      area. Choose smaller margins to set them explicitly.
                    </p>
                  )}
                </Section>
                <Section title="Columns">
                  <ColumnFields
                    page={p.project?.settings || {}}
                    rowClass="settings-row"
                    onChange={(value) => setting("columns", value)}
                  />
                </Section>
                <Section title="Page border"><PageBorderFields value={p.project?.settings.pageBorder} rowClass="settings-row" onChange={value=>setting('pageBorder',value)}/></Section>
                <Section title="Watermark"><WatermarkFields value={p.project?.settings.watermark} rowClass="settings-row" onChange={value=>setting('watermark',value)}/></Section>
                <Section title="Line numbering"><LineNumberFields value={p.project?.settings.lineNumbering} rowClass="settings-row" onChange={value=>setting('lineNumbering',value)}/></Section>
                <Section title="Notes"><NoteOptionsFields value={p.project?.settings.noteOptions} onChange={value=>setting('noteOptions',value)}/></Section>
                <Section title="Headers & numbering">
                  <button type="button" onClick={p.onRunningMatter}>
                    Headers and footers…
                  </button>
                  <label className="settings-row">
                    <span>Number format</span>
                    <select
                      aria-label="Page number format"
                      value={p.project?.settings.pageNumberFormat ?? "decimal"}
                      onChange={(e) =>
                        p.onChange((project) => {
                          project.settings.pageNumberFormat = e.target
                            .value as PageNumberFormat;
                        })
                      }
                    >
                      {Object.entries(pageNumberFormats).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {number(
                    "firstPageNumber",
                    "Start page numbering at",
                    1,
                    9999,
                    1,
                    1,
                  )}
                </Section>
              </fieldset>
            </>
          )}
          {p.category === "Publication" && (
            <>
              <fieldset disabled={!p.project}>
                <Section title="Book details">
                  {text("author", "Author")}
                  {text("description", "Description", true)}
                  {text("publisher", "Publisher")}
                  {text("subject", "Subject")}
                  {text("rights", "Rights statement")}
                  {text("identifier", "ISBN or identifier")}
                </Section>
                <Section title="Export">
                  {check("includeTitle", "Include title", true)}
                  {check("includeToc", "Table of contents")}
                  {check("includeGlossary", "Include glossary")}
                  <label className="settings-row">
                    Ebook cover
                    <select
                      aria-label="Ebook cover"
                      value={p.project?.settings.coverAssetId || ""}
                      onChange={(e) =>
                        setting("coverAssetId", e.target.value || null)
                      }
                    >
                      <option value="">No cover</option>
                      {p.project?.assets
                        .filter((asset) => asset.mime.startsWith("image/"))
                        .map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button onClick={() => p.onManage("assets")}>
                    Manage project assets…
                  </button>
                </Section>
              </fieldset>
            </>
          )}
          {p.category === "Speech" && (
            <>
              <Section title="Reading content">
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={readReferences === "true"}
                    onChange={(e) =>
                      setReadReferences(String(e.target.checked))
                    }
                  />
                  Read references
                </label>
                <p>
                  Read citations, source lists, linked text and URLs aloud. Off
                  skips detected references and their brackets and numbers.
                </p>
              </Section>
              <Playback scope="reading" title="Write" />
              <Playback scope="sandbox" title="Sandbox" />
              <Playback scope="narration" title="Narration" />
              <label className="settings-row">
                Narration format
                <select
                  aria-label="Narration format"
                  value={audioFormat}
                  onChange={(e) => setAudioFormat(e.target.value)}
                >
                  {["wav", "mp3", "flac"].map((format) => (
                    <option key={format} value={format}>
                      {format.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset disabled={!p.project}>
                <Section title="Speech generation">
                  <SpeechOptions
                    embedded
                    options={{
                      ...DEFAULT_SPEECH_OPTIONS,
                      ...p.project?.settings.speechOptions,
                    }}
                    onChange={(options) => setting("speechOptions", options)}
                  />
                  <button onClick={() => p.onManage("voices")}>
                    Manage voices & dictionaries…
                  </button>
                </Section>
              </fieldset>
            </>
          )}
          {p.category === "Language Rules" && (
            <>
              {p.project && (
                <Section title="Custom rules">
                  <RulesManager
                    project={p.project}
                    onChange={p.onChange}
                    onError={setError}
                  />
                  <button onClick={() => p.onManage("dictionary")}>
                    Project dictionary…
                  </button>
                </Section>
              )}
            </>
          )}
          {(error || p.saveError) && <p role="alert">{error || p.saveError}</p>}
        </div>
      </div>
      <footer>
        <span role="status">
          {p.project ? p.saveState : "Changes apply immediately"}
        </span>
        <button className="accent" onClick={p.onClose}>
          Done
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}

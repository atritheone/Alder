import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import {
  BookOpen,
  Download,
  Eye,
  LoaderCircle,
  Plus,
  Save,
  X,
} from "lucide-react";
import { api, download, mediaUrl, uid } from "./api";
import type { Project } from "./types";
import "./definition-studio.css";

type DefinitionEntry = Project["dictionary"][number] & {
  id?: string;
  ipa?: string;
  partOfSpeech?: string;
  pos?: string;
};
type CardEntry = {
  word: string;
  ipa: string;
  partOfSpeech: string;
  definition: string;
};
type CardOptions = { size: number; dpi: number };
type ExportResult = {
  filename: string;
  downloadUrl: string;
  warnings?: string[];
  validation?: {
    width?: number;
    height?: number;
    font?: string;
    definitionLines?: number;
  };
};
type Props = {
  project: Project;
  initialWord?: string;
  onChange: (mutate: (draft: Project) => void) => void;
  onClose: () => void;
  onError: (message: string) => void;
};
type StoredDraft = {
  selectedKey: string;
  entry: CardEntry;
  options: CardOptions;
};

const EMPTY: CardEntry = {
  word: "",
  ipa: "",
  partOfSpeech: "",
  definition: "",
};
const REFERENCE: CardEntry = {
  word: "Voyager",
  ipa: "/'vɔɪ.ɪ.dʒər/",
  partOfSpeech: "Noun",
  definition: "A Priest of Lucidity and the Manifest Reality.",
};
const keyOf = (entry: DefinitionEntry, index: number) =>
  entry.id ? `id:${entry.id}` : `index:${index}`;
const cardOf = (entry: DefinitionEntry): CardEntry => ({
  word: entry.word || "",
  ipa: entry.ipa || "",
  partOfSpeech: entry.partOfSpeech || entry.pos || "",
  definition: entry.definition || "",
});
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function initialDraft(project: Project, initialWord?: string): StoredDraft {
  const dictionary = project.dictionary as DefinitionEntry[];
  const index = dictionary.findIndex(
    (entry) =>
      entry.word.toLocaleLowerCase() ===
      initialWord?.trim().toLocaleLowerCase(),
  );
  const fallback = {
    selectedKey: index >= 0 ? keyOf(dictionary[index], index) : "draft",
    entry:
      index >= 0
        ? cardOf(dictionary[index])
        : { ...EMPTY, word: initialWord || "" },
    options: { size: 800, dpi: 96 },
  };
  try {
    const cached = JSON.parse(
      sessionStorage.getItem(`alder.definition-draft.${project.id}`) || "null",
    );
    if (
      cached &&
      cached.entry &&
      Object.keys(EMPTY).every(
        (key) => typeof cached.entry[key] === "string",
      ) &&
      (!initialWord ||
        cached.entry.word.toLocaleLowerCase() ===
          initialWord.toLocaleLowerCase())
    ) {
      return {
        selectedKey:
          typeof cached.selectedKey === "string" ? cached.selectedKey : "draft",
        entry: cached.entry,
        options: {
          size: Number(cached.options?.size) || 800,
          dpi: Number(cached.options?.dpi) || 96,
        },
      };
    }
  } catch {
    // A restricted or unavailable session store does not prevent editing.
  }
  return fallback;
}

/** Immediate editable preview. The server-rendered PNG is the exact export. */
function LayoutPreview({ entry }: { entry: CardEntry }) {
  const layout = useMemo(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const measure = (text: string, size: number, bold = false) => {
      if (!context) return text.length * size * 0.56;
      context.font = `${bold ? "bold " : ""}${size}px "Sitka Text", serif`;
      return context.measureText(text).width;
    };
    const word = entry.word || "Your word";
    let wordSize = 100;
    while (
      wordSize > 32 &&
      measure(word, wordSize) +
        (entry.ipa ? 24 + measure(entry.ipa, wordSize * 0.46) : 0) >
        590
    )
      wordSize--;
    let bodySize = 48;
    let lines: string[] = [];
    const definition =
      entry.definition || "Write the meaning you want this word to hold.";
    for (; bodySize >= 22; bodySize--) {
      lines = [];
      for (const paragraph of definition.split("\n")) {
        let current = "";
        for (let word of paragraph.split(/\s+/).filter(Boolean)) {
          if (
            measure(
              [current, word].filter(Boolean).join(" "),
              bodySize,
              true,
            ) <= 590
          ) {
            current = [current, word].filter(Boolean).join(" ");
          } else {
            if (current) lines.push(current);
            current = "";
            while (measure(word, bodySize, true) > 590) {
              let position = word.length - 1;
              while (
                position > 1 &&
                measure(word.slice(0, position), bodySize, true) > 590
              )
                position--;
              lines.push(word.slice(0, position));
              word = word.slice(position);
            }
            current = word;
          }
        }
        lines.push(current);
      }
      if (460 + (lines.length - 1) * bodySize * 1.03 + bodySize * 0.25 <= 704)
        break;
    }
    const overflow = bodySize < 22;
    return {
      word,
      wordSize,
      ipaX: 108 + measure(word, wordSize) + 24,
      bodySize: Math.max(bodySize, 22),
      lines,
      overflow,
    };
  }, [entry]);

  return (
    <div className="definition-live-card">
      <svg
        viewBox="0 0 800 800"
        role="img"
        aria-label={`Live definition card for ${entry.word || "your word"}`}
      >
        <rect width="800" height="800" fill="#fff" />
        <g fill="#050505" fontFamily="Sitka Text, serif">
          <text x="108" y="292" fontSize={layout.wordSize}>
            {layout.word}
          </text>
          {entry.ipa && (
            <text x={layout.ipaX} y="292" fontSize={layout.wordSize * 0.46}>
              {entry.ipa}
            </text>
          )}
          <line
            x1="101"
            x2="700"
            y1="316"
            y2="316"
            stroke="#050505"
            strokeWidth="4"
          />
          <text x="108" y="373" fontSize="50" fontStyle="italic">
            {entry.partOfSpeech || "Part of speech"}
          </text>
          {!layout.overflow &&
            layout.lines.map((line, index) => (
              <text
                key={index}
                x="108"
                y={460 + index * layout.bodySize * 1.03}
                fontSize={layout.bodySize}
                fontWeight="bold"
              >
                {line}
              </text>
            ))}
        </g>
        {layout.overflow && (
          <text x="108" y="460" fontSize="24" fill="#8b3a22">
            Shorten this definition to fit the card.
          </text>
        )}
      </svg>
    </div>
  );
}

export default function DefinitionStudio({
  project,
  initialWord,
  onChange,
  onClose,
  onError,
}: Props) {
  const [initial] = useState(() => initialDraft(project, initialWord));
  const [entry, setEntry] = useState<CardEntry>(initial.entry);
  const [selectedKey, setSelectedKey] = useState(initial.selectedKey);
  const [options, setOptions] = useState<CardOptions>(initial.options);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    signature: string;
    result: ExportResult;
  } | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const drafts = useRef(new Map<string, CardEntry>());
  const modalRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const dictionary = project.dictionary as DefinitionEntry[];
  const signature = JSON.stringify({ entry, options });
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  const accuratePreview =
    preview?.signature === signature ? preview.result : null;
  const selectedIndex = dictionary.findIndex(
    (item, index) => keyOf(item, index) === selectedKey,
  );
  const savedEntry = selectedIndex >= 0 ? dictionary[selectedIndex] : null;
  const changed =
    !savedEntry || JSON.stringify(cardOf(savedEntry)) !== JSON.stringify(entry);
  const validText = !!entry.word.trim() && !!entry.definition.trim();
  const dimensionsValid =
    Number.isInteger(options.size) &&
    options.size >= 256 &&
    options.size <= 4096 &&
    Number.isFinite(options.dpi) &&
    options.dpi >= 72 &&
    options.dpi <= 600;

  useEffect(() => {
    try {
      sessionStorage.setItem(
        `alder.definition-draft.${project.id}`,
        JSON.stringify({ selectedKey, entry, options }),
      );
    } catch {
      // In-memory state remains intact when browser storage is unavailable.
    }
  }, [entry, options, selectedKey, project.id]);

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    modalRef.current
      ?.querySelector<HTMLInputElement>('[name="definition-word"]')
      ?.focus();
    return () => previous?.focus();
  }, []);

  function report(message: string) {
    setError(message);
    setNotice("");
    onError(message);
  }

  function edit(field: keyof CardEntry, value: string) {
    setEntry((previous) => ({ ...previous, [field]: value }));
    setError("");
    setNotice("");
    setResult(null);
  }

  function select(key: string) {
    drafts.current.set(selectedKey, { ...entry });
    const item = dictionary.find(
      (candidate, index) => keyOf(candidate, index) === key,
    );
    setEntry(drafts.current.get(key) || (item ? cardOf(item) : { ...EMPTY }));
    setSelectedKey(key);
    setError("");
    setNotice("");
    setResult(null);
  }

  function save() {
    if (!validText) {
      report("Enter a headword and definition before saving.");
      return;
    }
    const id = savedEntry?.id || uid();
    const clean = Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [key, value.trim()]),
    ) as CardEntry;
    try {
      onChange((draft) => {
        const items = draft.dictionary as DefinitionEntry[];
        const index = items.findIndex(
          (item, position) => keyOf(item, position) === selectedKey,
        );
        if (index >= 0) {
          items[index] = { ...items[index], ...clean, id };
        } else {
          items.push({ ...clean, id, preferred: null });
        }
      });
      drafts.current.delete(selectedKey);
      setSelectedKey(`id:${id}`);
      setEntry(clean);
      setNotice(
        savedEntry
          ? "Definition updated in this project."
          : "Definition added to this project.",
      );
      setError("");
    } catch (failure) {
      report(messageOf(failure));
    }
  }

  async function render(format: "png" | "jpg" | "pdf", previewOnly = false) {
    if (!validText)
      return report(
        "Enter a headword and definition before rendering the card.",
      );
    if (!dimensionsValid)
      return report(
        "Choose a whole-number size from 256 to 4096 pixels and a DPI from 72 to 600.",
      );
    const snapshot = { entry: { ...entry }, options: { ...options } };
    const requestedSignature = signature;
    setBusy(previewOnly ? "preview" : format);
    setError("");
    setNotice("");
    setResult(null);
    try {
      const exported = await api<ExportResult>(
        `/api/projects/${encodeURIComponent(project.id)}/definition-export`,
        "POST",
        { entry: snapshot.entry, format, options: snapshot.options },
      );
      if (!exported.downloadUrl || !exported.filename)
        throw new Error(
          "The card renderer did not return a downloadable file. Your definition is still here.",
        );
      if (format === "png")
        setPreview({ signature: requestedSignature, result: exported });
      setResult(exported);
      if (previewOnly) {
        setNotice(
          signatureRef.current === requestedSignature
            ? "Rendered preview ready."
            : "The earlier wording was rendered. Preview again to include your latest edit.",
        );
      } else {
        const destination = await download(
          exported.downloadUrl,
          exported.filename,
        );
        setNotice(
          destination
            ? `${format === "jpg" ? "JPEG" : format.toUpperCase()} exported for “${snapshot.entry.word}”.`
            : "Save cancelled. The rendered card is ready to download again.",
        );
      }
    } catch (failure) {
      report(messageOf(failure));
    } finally {
      setBusy(null);
    }
  }

  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key === "Tab") {
      const elements = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]",
        ) || [],
      );
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  return (
    <div className="modal-backdrop definition-studio-backdrop">
      <section
        className="modal definition-studio"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={modalRef}
        onKeyDown={keyboard}
      >
        <header>
          <div className="definition-studio-title">
            <BookOpen size={16} />
            <div>
              <strong id={titleId}>Definition cards</strong>
              <span>Create a meaning, then give it a page.</span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close definition cards"
            title="Close"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>
        <div className="definition-studio-body">
          <div className="definition-form">
            <div className="definition-library-row">
              <label>
                Project definitions
                <select
                  aria-label="Project definitions"
                  value={selectedIndex < 0 ? "draft" : selectedKey}
                  onChange={(event) => select(event.target.value)}
                >
                  <option value="draft">Unsaved draft</option>
                  {dictionary.map((item, index) => (
                    <option key={keyOf(item, index)} value={keyOf(item, index)}>
                      {item.word}
                      {item.partOfSpeech || item.pos
                        ? ` · ${item.partOfSpeech || item.pos}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                title="New definition"
                aria-label="New definition"
                onClick={() => select("draft")}
              >
                <Plus size={16} />
              </button>
            </div>

            <label>
              Headword
              <input
                name="definition-word"
                value={entry.word}
                maxLength={120}
                onChange={(event) => edit("word", event.target.value)}
                placeholder="Your word"
                autoComplete="off"
              />
            </label>
            <div className="definition-field-pair">
              <label>
                Pronunciation · IPA
                <input
                  value={entry.ipa}
                  maxLength={240}
                  onChange={(event) => edit("ipa", event.target.value)}
                  placeholder="/pronunciation/"
                  spellCheck={false}
                />
              </label>
              <label>
                Part of speech
                <input
                  value={entry.partOfSpeech}
                  maxLength={120}
                  onChange={(event) => edit("partOfSpeech", event.target.value)}
                  placeholder="Noun"
                  list="definition-parts"
                />
                <datalist id="definition-parts">
                  <option>Noun</option>
                  <option>Verb</option>
                  <option>Adjective</option>
                  <option>Adverb</option>
                  <option>Pronoun</option>
                  <option>Phrase</option>
                </datalist>
              </label>
            </div>
            <label>
              Definition
              <textarea
                value={entry.definition}
                maxLength={5000}
                onChange={(event) => edit("definition", event.target.value)}
                rows={5}
                placeholder="Write your definition. Line breaks are preserved."
              />
            </label>
            <div className="definition-writing-state">
              <span>{entry.definition.length.toLocaleString()} characters</span>
              <span>{changed ? "Draft changes" : "In project dictionary"}</span>
            </div>
            <button
              type="button"
              className="accent definition-save"
              onClick={save}
              disabled={!validText}
            >
              <Save size={14} />
              Save definition
            </button>

            <div className="definition-output-settings">
              <div className="definition-subheading">Card output</div>
              <div className="definition-field-pair">
                <label>
                  Square size · pixels
                  <input
                    type="number"
                    min={256}
                    max={4096}
                    step={1}
                    value={Number.isNaN(options.size) ? "" : options.size}
                    onChange={(event) => {
                      setOptions((previous) => ({
                        ...previous,
                        size:
                          event.target.value === ""
                            ? NaN
                            : Number(event.target.value),
                      }));
                      setResult(null);
                    }}
                  />
                </label>
                <label>
                  Print resolution · DPI
                  <input
                    type="number"
                    min={72}
                    max={600}
                    step={1}
                    value={Number.isNaN(options.dpi) ? "" : options.dpi}
                    onChange={(event) => {
                      setOptions((previous) => ({
                        ...previous,
                        dpi:
                          event.target.value === ""
                            ? NaN
                            : Number(event.target.value),
                      }));
                      setResult(null);
                    }}
                  />
                </label>
              </div>
              <p>
                Type adjusts to fit your wording. The rendered card uses Alder’s
                bundled Liberation Serif font.
              </p>
              <div className="definition-reference-row">
                <span>Reference layout</span>
                <button
                  type="button"
                  onClick={() => {
                    drafts.current.set(selectedKey, { ...entry });
                    setSelectedKey("reference");
                    setEntry({ ...REFERENCE });
                    setNotice(
                      "Voyager reference loaded as a sample. Save only if you want it in this project.",
                    );
                    setError("");
                    setResult(null);
                  }}
                >
                  Voyager reference
                </button>
              </div>
            </div>
          </div>

          <div className="definition-preview-column">
            <div className="definition-preview-label">
              <span>{accuratePreview ? "Rendered card" : "Live layout"}</span>
              <span>
                {dimensionsValid
                  ? `${options.size} × ${options.size}`
                  : "Choose an output size"}
              </span>
            </div>
            <div
              className="definition-preview-frame"
              style={
                {
                  "--definition-preview-size": `${options.size}px`,
                } as CSSProperties
              }
            >
              {accuratePreview ? (
                <img
                  src={mediaUrl(accuratePreview.downloadUrl)}
                  alt={`Rendered definition card for ${entry.word}`}
                  onError={() => {
                    setPreview(null);
                    report(
                      "The rendered preview could not be loaded. Your definition and export controls are still available.",
                    );
                  }}
                />
              ) : (
                <LayoutPreview entry={entry} />
              )}
            </div>
            <div className="definition-preview-bottom">
              <p>
                {accuratePreview
                  ? "This is the same card used for the PNG export."
                  : preview
                    ? "Your wording changed. Preview again for the exact card."
                    : "Render a preview to see the exact font, spacing and line breaks."}
              </p>
              <button
                type="button"
                onClick={() => render("png", true)}
                disabled={!!busy || !validText || !dimensionsValid}
              >
                {busy === "preview" ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Eye size={14} />
                )}
                Preview card
              </button>
            </div>
            <div
              className="definition-feedback"
              aria-live="polite"
              aria-atomic="true"
            >
              {busy && (
                <p className="definition-progress">
                  <LoaderCircle size={13} className="spin" />
                  {busy === "preview"
                    ? "Rendering your preview…"
                    : `Preparing ${busy === "jpg" ? "JPEG" : busy.toUpperCase()}…`}
                </p>
              )}
              {error && (
                <p className="definition-error" role="alert">
                  {error}
                </p>
              )}
              {notice && <p>{notice}</p>}
              {result?.warnings?.map((warning, index) => (
                <p className="definition-warning" key={index}>
                  {warning}
                </p>
              ))}
            </div>
          </div>
        </div>
        <footer>
          <span>
            {savedEntry
              ? `Editing “${savedEntry.word}”`
              : "A new definition for this project"}
          </span>
          {(["png", "jpg", "pdf"] as const).map((format) => (
            <button
              key={format}
              type="button"
              className={format === "png" ? "accent" : ""}
              onClick={() => render(format)}
              disabled={!!busy || !validText || !dimensionsValid}
            >
              {busy === format ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <Download size={13} />
              )}
              Export {format === "jpg" ? "JPEG" : format.toUpperCase()}
            </button>
          ))}
        </footer>
      </section>
    </div>
  );
}

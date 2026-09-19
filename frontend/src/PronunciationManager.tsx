import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, FilePenLine, Pencil, Plus, X } from "lucide-react";
import { api, download, mediaUrl, uid, upload } from "./api";
import type { Job, Pronunciation, Project, Voice } from "./types";
import { PatternEditor, ReplacementEditor } from "./PronunciationPattern";
import { useSpeechJob } from "./useSpeechJob";
import { useSpeechTransport } from "./useSpeechTransport";
import { useNarrationGain } from "./audioPlayback";
import "./pronunciation.css";
const modes = {
  whole: "Whole Word Or Phrase",
  start: "Starts A Word",
  end: "Ends A Word",
  anywhere: "Anywhere In Text",
  pattern: "Pattern With Conditions",
};
const fresh = (): Pronunciation => ({
  id: uid(),
  word: "",
  spoken: "",
  syntax: "rex",
  matchMode: "whole",
  caseSensitive: false,
  voiceId: null,
  enabled: true,
  dictionary: "My Rules",
});
export default function PronunciationManager(p: {
  project: Project;
  voices: Voice[];
  change: (fn: (p: Project) => void) => void;
  flush: () => Promise<void>;
  onPlaybackChange: (p: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState<Pronunciation>(fresh),
    [query, setQuery] = useState(""),
    [dictionary, setDictionary] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [sample, setSample] = useState(""),
    [preview, setPreview] = useState<{
      spoken: string;
      mappings: { word: string; spoken: string }[];
    } | null>(null);
  const [scope, setScope] = useState("rule"),
    [voice, setVoice] = useState(p.voices[0]?.id || "default"),
    [job, setJob] = useState<Job | null>(null),
    [testing, setTesting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState(false);
  const [addMenu, setAddMenu] = useState<{ top: number; left: number } | null>(
    null,
  );
  const addButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenu) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (e: PointerEvent) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !addButton.current?.contains(e.target as Node)
      )
        setAddMenu(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setAddMenu(null);
        addButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
    };
  }, [addMenu]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dictionaryName, setDictionaryName] = useState("");
  const renameTarget = useRef<string | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming !== null) {
      renameInput.current?.focus();
      renameInput.current?.select();
    }
  }, [renaming]);
  useEffect(() => {
    if (editing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing]);
  const file = useRef<HTMLInputElement>(null),
    audio = useRef<HTMLAudioElement>(null),
    request = useRef(0),
    loaded = useRef(""),
    choosing = useRef(0);
  const gain = useNarrationGain(audio);
  const transport = useSpeechTransport(audio, () => setTesting(false));
  const currentJob = useRef(job);
  currentJob.current = job;
  const stop = () => {
    request.current++;
    transport.stop();
    setTesting(false);
    p.onPlaybackChange(false);
    const active = currentJob.current;
    if (active && !["ready", "failed", "cancelled"].includes(active.status))
      void api(`/api/speech/jobs/${active.id}/cancel`, "POST").catch(() => {});
  };
  useEffect(
    () => () => {
      request.current++;
      audio.current?.pause();
      p.onPlaybackChange(false);
      const active = currentJob.current;
      if (active && !["ready", "failed", "cancelled"].includes(active.status))
        void api(`/api/speech/jobs/${active.id}/cancel`, "POST").catch(
          () => {},
        );
    },
    [],
  );
  useEffect(() => {
    setPreview(null);
  }, [draft, sample, scope, voice]);
  useSpeechJob(job, setJob);
  useEffect(() => {
    if (!testing || !job) return;
    if (
      ["failed", "cancelled", "interrupted", "needs_review"].includes(
        job.status,
      )
    ) {
      setError(job.error || "The pronunciation test could not finish.");
      setTesting(false);
      return;
    }
    if (
      job.status === "ready" &&
      job.audioUrl &&
      audio.current &&
      loaded.current !== job.id
    ) {
      loaded.current = job.id;
      audio.current.src = mediaUrl(job.audioUrl);
      void transport.play().catch((e) => {
        setError(e.message);
        setTesting(false);
      });
    }
  }, [job, testing]);
  const rules = p.project.pronunciation;
  const dictionaries = [
    ...new Set([
      ...(p.project.settings.pronunciationDictionaries || []),
      ...rules.map((r) => r.dictionary || "My Rules"),
    ]),
  ];
  const disabledDictionaries =
    p.project.settings.disabledPronunciationDictionaries || [];
  const toggleDictionary = (name: string, active: boolean) => {
    p.change((project) => {
      const disabled = project.settings.disabledPronunciationDictionaries || [];
      project.settings.disabledPronunciationDictionaries = active
        ? disabled.filter((d) => d !== name)
        : [...new Set([...disabled, name])];
    });
  };
  const filtered = rules.filter(
    (r) =>
      (!dictionary || (r.dictionary || "My Rules") === dictionary) &&
      `${r.word} ${r.spoken}`.toLowerCase().includes(query.toLowerCase()),
  );
  const patch = (fields: Partial<Pronunciation>) =>
    setDraft((d) => ({ ...d, ...fields }));
  const testRules = () => {
    if (scope === "rule") return [draft];
    const candidates = rules.some((r) => r.id === draft.id)
      ? rules.map((r) => (r.id === draft.id ? draft : r))
      : [...rules, draft];
    return candidates.filter(
      (r) => !disabledDictionaries.includes(r.dictionary || "My Rules"),
    );
  };
  const choose = async (rule: Pronunciation) => {
    stop();
    const token = ++choosing.current;
    setSelected(rule.id);
    setError("");
    setPreview(null);
    setDraft(structuredClone(rule));
    try {
      const converted = await api<Pronunciation>(
        "/api/pronunciation/editor",
        "POST",
        { rule },
      );
      if (token === choosing.current) setDraft(converted);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const valid = await api<Pronunciation>(
        "/api/pronunciation/validate",
        "POST",
        { rule: draft },
      );
      p.change((project) => {
        const at = project.pronunciation.findIndex((r) => r.id === draft.id);
        project.settings.pronunciationDictionaries = [
          ...new Set([...dictionaries, valid.dictionary || "My Rules"]),
        ];
        if (at < 0) project.pronunciation.push(valid);
        else project.pronunciation[at] = valid;
      });
      setSelected(draft.id);
      setDictionary(draft.dictionary || "My Rules");
      setNotice("Rule Saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const move = (offset: number) => {
    p.change((project) => {
      const at = project.pronunciation.findIndex((r) => r.id === selected),
        to = at + offset;
      if (at >= 0 && to >= 0 && to < project.pronunciation.length)
        project.pronunciation.splice(
          to,
          0,
          project.pronunciation.splice(at, 1)[0],
        );
    });
  };
  const importFile = async (f: File) => {
    setBusy(true);
    setError("");
    try {
      const result = await upload<{
        rules: Pronunciation[];
        errors: { line: number; message: string }[];
        name: string;
      }>("/api/pronunciation/import", f);
      p.change((project) => {
        project.pronunciation.push(...result.rules);
        project.settings.pronunciationDictionaries = [
          ...new Set([
            ...(project.settings.pronunciationDictionaries || []),
            result.name,
          ]),
        ];
      });
      setDictionary(result.name);
      setQuery("");
      if (result.rules[0]) {
        setSelected(result.rules[0].id);
        setDraft(result.rules[0]);
      }
      setNotice(
        `${result.rules.length} ${result.rules.length === 1 ? "Rule" : "Rules"} Imported`,
      );
      if (result.errors.length)
        setError(
          result.errors.map((e) => `Line ${e.line}: ${e.message}`).join("\n"),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const runPreview = async () => {
    setError("");
    try {
      setPreview(
        await api("/api/pronunciation/preview", "POST", {
          text: sample,
          rules: testRules(),
          voiceId: voice,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const play = async () => {
    if (testing) {
      stop();
      return;
    }
    setError("");
    setTesting(true);
    const token = ++request.current;
    transport.prepare();
    loaded.current = "";
    try {
      const result = await api<Job>(
        `/api/projects/${p.project.id}/pronunciation/test`,
        "POST",
        { text: sample, rules: testRules(), voiceId: voice },
      );
      if (token !== request.current) {
        await api(`/api/speech/jobs/${result.id}/cancel`, "POST");
        return;
      }
      setJob(result);
    } catch (e) {
      if (token === request.current) {
        setError((e as Error).message);
        setTesting(false);
      }
    }
  };
  const closeEditor = () => {
    stop();
    setEditing(false);
  };
  const openDictionary = (name: string) => {
    setDictionary(name);
    setQuery("");
    const first = rules.find((r) => (r.dictionary || "My Rules") === name);
    if (first) void choose(first);
    else {
      stop();
      choosing.current++;
      setSelected(null);
      setDraft({ ...fresh(), dictionary: name || "My Rules" });
      setError("");
    }
    setEditing(true);
  };
  const beginRename = (name: string) => {
    setDictionary(name);
    setDictionaryName(name);
    renameTarget.current = name;
    setRenaming(name);
    setError("");
  };
  const createDictionary = () => {
    let name = "New Dictionary";
    for (let i = 2; dictionaries.includes(name); i++)
      name = `New Dictionary ${i}`;
    p.change((project) => {
      project.settings.pronunciationDictionaries = [...dictionaries, name];
    });
    beginRename(name);
  };
  const finishRename = () => {
    const oldName = renameTarget.current;
    if (oldName === null) return;
    const name = dictionaryName.trim();
    if (!name || (name !== oldName && dictionaries.includes(name))) {
      setError(
        !name
          ? "Enter a dictionary name."
          : "A dictionary with that name already exists.",
      );
      renameInput.current?.focus();
      return;
    }
    renameTarget.current = null;
    setRenaming(null);
    if (name === oldName) return;
    choosing.current++;
    p.change((project) => {
      project.settings.pronunciationDictionaries = dictionaries.map((d) =>
        d === oldName ? name : d,
      );
      project.settings.disabledPronunciationDictionaries =
        disabledDictionaries.map((d) => (d === oldName ? name : d));
      for (const rule of project.pronunciation)
        if ((rule.dictionary || "My Rules") === oldName) rule.dictionary = name;
    });
    setDraft((rule) =>
      (rule.dictionary || "My Rules") === oldName
        ? { ...rule, dictionary: name }
        : rule,
    );
    setDictionary(name);
    setError("");
  };
  const removeDictionary = (name: string) => {
    stop();
    choosing.current++;
    renameTarget.current = null;
    setRenaming(null);
    p.change((project) => {
      project.settings.pronunciationDictionaries = dictionaries.filter(
        (d) => d !== name,
      );
      project.settings.disabledPronunciationDictionaries =
        disabledDictionaries.filter((d) => d !== name);
      project.pronunciation = project.pronunciation.filter(
        (r) => (r.dictionary || "My Rules") !== name,
      );
    });
    if ((draft.dictionary || "My Rules") === name) {
      setSelected(null);
      setDraft(fresh());
    }
    if (dictionary === name) setDictionary("");
    setError("");
  };
  return (
    <>
      <section
        className="pronunciation-manager pronunciation-library"
        aria-label="Pronunciation Dictionaries"
      >
        <header className="voice-library-heading dictionary-section-heading">
          <h3>Dictionaries</h3>
          <button
            className="library-add-button"
            ref={addButton}
            aria-label="Add or create dictionary"
            aria-haspopup="menu"
            aria-expanded={!!addMenu}
            data-help="Add or create a pronunciation dictionary."
            onClick={() => {
              const rect = addButton.current!.getBoundingClientRect();
              const scale =
                Number(
                  getComputedStyle(document.documentElement).getPropertyValue(
                    "--ui-scale",
                  ),
                ) || 1;
              setAddMenu(
                addMenu
                  ? null
                  : {
                      top: rect.bottom / scale + 3,
                      left: Math.max(116, rect.right / scale),
                    },
              );
            }}
            disabled={busy}
          >
            <Plus size={19} />
          </button>
        </header>
        <div
          className="voice-group dictionary-cards"
          aria-label="Available dictionaries"
        >
          {dictionaries.map((name) => (
            <div
              key={name}
              className={`voice-card${dictionary === name ? " selected" : ""}`}
              onClick={(e) => {
                if (!(e.target as Element).closest("button, input, form"))
                  setDictionary(name);
              }}
            >
              <div className="voice-card-name">
                <BookOpen size={17} />
                {renaming === name ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      finishRename();
                    }}
                  >
                    <input
                      ref={renameInput}
                      aria-label="Dictionary name"
                      value={dictionaryName}
                      maxLength={100}
                      required
                      onChange={(e) => setDictionaryName(e.target.value)}
                      onBlur={finishRename}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Escape") {
                          e.preventDefault();
                          renameTarget.current = null;
                          setRenaming(null);
                          setError("");
                        }
                      }}
                    />
                  </form>
                ) : (
                  <button
                    className="voice-name-button"
                    aria-label={`Select dictionary ${name}`}
                    aria-pressed={dictionary === name}
                    onClick={() => setDictionary(name)}
                    onDoubleClick={() => beginRename(name)}
                    onKeyDown={(e) => {
                      if (e.key === "F2") {
                        e.preventDefault();
                        beginRename(name);
                      }
                    }}
                  >
                    {name}
                  </button>
                )}
                <input
                  type="checkbox"
                  className="dictionary-active-checkbox"
                  aria-label={`Active dictionary ${name}`}
                  data-help="Use this dictionary during TTS. Multiple dictionaries can be active."
                  checked={!disabledDictionaries.includes(name)}
                  onChange={(e) => toggleDictionary(name, e.target.checked)}
                />
              </div>
              <div className="voice-card-actions">
                <small className="dictionary-rule-count">
                  {
                    rules.filter((r) => (r.dictionary || "My Rules") === name)
                      .length
                  }{" "}
                  Rules
                </small>
                <button
                  aria-label={`Rename dictionary ${name}`}
                  data-help="Rename dictionary."
                  disabled={busy}
                  onClick={() => beginRename(name)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  aria-label={`Edit dictionary ${name}`}
                  data-help="Edit dictionary rules and test pronunciation."
                  disabled={busy}
                  onClick={() => openDictionary(name)}
                >
                  <FilePenLine size={14} />
                </button>
                <button
                  aria-label={`Remove dictionary ${name}`}
                  data-help="Remove this dictionary and its rules."
                  disabled={busy}
                  onClick={() => removeDictionary(name)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
        {!dictionaries.length && <small>No dictionaries</small>}
        {!editing && notice && <small role="status">{notice}</small>}
        {!editing && error && <p role="alert">{error}</p>}
      </section>
      {addMenu &&
        createPortal(
          <div
            ref={menu}
            className="menu-popup dictionary-add-menu"
            role="menu"
            aria-label="Add dictionary"
            style={{
              position: "fixed",
              top: addMenu.top,
              left: addMenu.left,
              zIndex: 10000,
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setAddMenu(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const buttons = Array.from(
                  e.currentTarget.querySelectorAll("button"),
                );
                const index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                buttons[
                  (index + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                    buttons.length
                ]?.focus();
              }
            }}
          >
            <button
              role="menuitem"
              onClick={() => {
                setAddMenu(null);
                file.current?.click();
              }}
            >
              Add
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setAddMenu(null);
                createDictionary();
              }}
            >
              Create
            </button>
          </div>,
          document.body,
        )}
      {createPortal(
        <dialog
          ref={dialog}
          className="pronunciation-dialog"
          aria-labelledby="pronunciation-dialog-title"
          onCancel={(e) => {
            e.preventDefault();
            closeEditor();
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <header>
            <strong id="pronunciation-dialog-title">
              Pronunciation{dictionary ? ` — ${dictionary}` : " Dictionaries"}
            </strong>
            <button aria-label="Close Dictionary Editor" onClick={closeEditor}>
              ×
            </button>
          </header>
          <section
            className="pronunciation-manager pronunciation-dialog-body"
            aria-label="Pronunciation Dictionary"
          >
            <div className="pronunciation-list-panel">
              <div className="pronunciation-actions">
                <button disabled={busy} onClick={() => file.current?.click()}>
                  Import REX…
                </button>
                <button
                  disabled={!rules.length || busy}
                  onClick={() =>
                    void (async () => {
                      try {
                        await p.flush();
                        await download(
                          `/api/projects/${p.project.id}/pronunciation/rex?dictionary=${encodeURIComponent(dictionary)}`,
                          dictionary || "pronunciation.rex",
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    })()
                  }
                >
                  Export REX…
                </button>
                <button
                  onClick={() => {
                    stop();
                    setSelected(null);
                    choosing.current++;
                    setDraft({
                      ...fresh(),
                      dictionary: dictionary || "My Rules",
                    });
                    setError("");
                    setNotice("");
                  }}
                >
                  New Rule
                </button>
              </div>
              <input
                hidden
                ref={file}
                type="file"
                accept=".rex"
                aria-label="Import Pronunciation Dictionary"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                  e.target.value = "";
                }}
              />
              <label>
                Dictionary
                <select
                  aria-label="Pronunciation Dictionary Filter"
                  value={dictionary}
                  onChange={(e) => setDictionary(e.target.value)}
                >
                  <option value="">All Dictionaries</option>
                  {dictionaries.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <input
                aria-label="Find Pronunciation"
                placeholder="Find Pronunciation"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div
                className="pronunciation-rules"
                role="listbox"
                aria-label="Pronunciation Rules"
                data-help="Rules run from top to bottom. A later rule can change text produced by an earlier rule. Move rules to change their priority."
              >
                {filtered.map((r) => (
                  <button
                    role="option"
                    aria-selected={selected === r.id}
                    key={r.id}
                    onClick={() => void choose(r)}
                  >
                    <span>
                      {r.enabled === false ? "○ " : ""}
                      {r.matchMode === "pattern" ? "Pattern" : r.word}
                    </span>
                    <span>
                      →{" "}
                      {r.replacementParts ? "Spoken Parts" : r.spoken || "Omit"}
                    </span>
                    <small>
                      {modes[r.matchMode || (r.regex ? "pattern" : "whole")]}
                      {r.caseSensitive ? " · Match Case" : ""}
                    </small>
                  </button>
                ))}
              </div>
              <div className="pronunciation-actions">
                <button
                  disabled={!selected || rules[0]?.id === selected}
                  onClick={() => move(-1)}
                >
                  Move Up
                </button>
                <button
                  disabled={!selected || rules.at(-1)?.id === selected}
                  onClick={() => move(1)}
                >
                  Move Down
                </button>
                <button
                  disabled={!selected}
                  onClick={() => {
                    stop();
                    p.change((project) => {
                      project.settings.pronunciationDictionaries = dictionaries;
                      project.pronunciation = project.pronunciation.filter(
                        (r) => r.id !== selected,
                      );
                    });
                    setSelected(null);
                    setDraft(fresh());
                  }}
                >
                  Remove Rule
                </button>
              </div>
            </div>
            <div className="pronunciation-detail-panel">
              <form
                className="pronunciation-editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <label>
                  Match
                  <select
                    aria-label="Pronunciation Match"
                    value={
                      draft.matchMode || (draft.regex ? "pattern" : "whole")
                    }
                    onChange={(e) => {
                      const mode = e.target.value as Pronunciation["matchMode"];
                      patch({
                        matchMode: mode,
                        regex: mode === "pattern",
                        patternParts:
                          mode === "pattern"
                            ? [{ kind: "text", value: draft.word }]
                            : undefined,
                      });
                    }}
                  >
                    {Object.entries(modes).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.matchMode !== "pattern" ? (
                  <label>
                    Written Text
                    <input
                      aria-label="Written Text"
                      required
                      value={draft.word}
                      onChange={(e) => patch({ word: e.target.value })}
                    />
                  </label>
                ) : (
                  <PatternEditor
                    parts={
                      draft.patternParts || [
                        { kind: "text", value: draft.word },
                      ]
                    }
                    onChange={(patternParts) =>
                      patch({ patternParts, word: "Pattern", regex: true })
                    }
                  />
                )}
                <div className="pronunciation-switches">
                  <label data-help="Only match the exact uppercase and lowercase letters you enter.">
                    <input
                      type="checkbox"
                      checked={draft.caseSensitive}
                      onChange={(e) =>
                        patch({ caseSensitive: e.target.checked })
                      }
                    />
                    Match Capitalisation
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.enabled !== false}
                      onChange={(e) => patch({ enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                </div>
                {!draft.replacementParts ? (
                  <label data-help="Write the sounds you want the voice to say. Leave empty to omit matching text from speech.">
                    Speak As
                    <input
                      aria-label="Speak As"
                      value={draft.spoken}
                      onChange={(e) => patch({ spoken: e.target.value })}
                    />
                  </label>
                ) : (
                  <ReplacementEditor
                    parts={draft.replacementParts}
                    onChange={(replacementParts) => patch({ replacementParts })}
                  />
                )}
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      replacementParts: draft.replacementParts
                        ? undefined
                        : [{ kind: "text", text: draft.spoken, case: "keep" }],
                    })
                  }
                >
                  {draft.replacementParts
                    ? "Use Simple Replacement"
                    : "Build Spoken Parts"}
                </button>
                <label data-help="Apply this pronunciation to every voice, or only the selected voice.">
                  Apply To Voice
                  <select
                    aria-label="Pronunciation Voice"
                    value={draft.voiceId || ""}
                    onChange={(e) => patch({ voiceId: e.target.value || null })}
                  >
                    <option value="">All Voices</option>
                    {p.voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Save In Dictionary
                  <input
                    aria-label="Rule Dictionary"
                    value={draft.dictionary || "My Rules"}
                    onChange={(e) => patch({ dictionary: e.target.value })}
                  />
                </label>
                <button type="submit" disabled={busy}>
                  Save Rule
                </button>
              </form>
              <div className="pronunciation-test">
                <label>
                  Test Text
                  <textarea
                    aria-label="Pronunciation Test Text"
                    value={sample}
                    onChange={(e) => {
                      stop();
                      setSample(e.target.value);
                    }}
                  />
                </label>
                <label>
                  Test Rules
                  <select
                    aria-label="Test Rules"
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                  >
                    <option value="rule">This Rule</option>
                    <option value="all">All Rules In Order</option>
                  </select>
                </label>
                <label>
                  Test Voice
                  <select
                    aria-label="Pronunciation Test Voice"
                    value={voice}
                    onChange={(e) => {
                      stop();
                      setVoice(e.target.value);
                    }}
                  >
                    {p.voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="pronunciation-actions">
                  <button onClick={() => void runPreview()}>
                    Show Spoken Text
                  </button>
                  <button disabled={!sample.trim()} onClick={() => void play()}>
                    {testing ? "Stop Test" : "Test Voice"}
                  </button>
                  {testing && (
                    <span role="status">
                      {job?.status === "ready" ? "Playing…" : "Preparing…"}
                    </span>
                  )}
                </div>
                {preview && (
                  <>
                    <output aria-label="Spoken Text">
                      {preview.spoken || "Nothing Will Be Spoken"}
                    </output>
                    <small>{preview.mappings.length} Substitutions</small>
                  </>
                )}
                <audio
                  ref={audio}
                  onPlay={() => {
                    void gain();
                    p.onPlaybackChange(true);
                  }}
                  onEnded={() => {
                    setTesting(false);
                    p.onPlaybackChange(false);
                  }}
                  onError={() => {
                    setError("The pronunciation test audio could not play.");
                    setTesting(false);
                    p.onPlaybackChange(false);
                  }}
                />
              </div>
            </div>
            <footer className="pronunciation-dialog-status">
              {notice && (
                <p role="status" aria-label="Dictionary Status">
                  {notice}
                </p>
              )}
              {error && (
                <p role="alert" className="pronunciation-error">
                  {error}
                </p>
              )}
            </footer>
          </section>
          <footer className="pronunciation-dialog-footer">
            <span>Changes Are Saved With Your Project</span>
            <button onClick={closeEditor}>Close</button>
          </footer>
        </dialog>,
        document.body,
      )}
    </>
  );
}

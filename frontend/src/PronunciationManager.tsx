import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
    ...new Set(rules.map((r) => r.dictionary || "My Rules")),
  ];
  const filtered = rules.filter(
    (r) =>
      (!dictionary || (r.dictionary || "My Rules") === dictionary) &&
      `${r.word} ${r.spoken}`.toLowerCase().includes(query.toLowerCase()),
  );
  const patch = (fields: Partial<Pronunciation>) =>
    setDraft((d) => ({ ...d, ...fields }));
  const testRules = () =>
    scope === "rule"
      ? [draft]
      : rules.some((r) => r.id === draft.id)
        ? rules.map((r) => (r.id === draft.id ? draft : r))
        : [...rules, draft];
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
    setEditing(true);
    setBusy(true);
    setError("");
    try {
      const result = await upload<{
        rules: Pronunciation[];
        errors: { line: number; message: string }[];
        name: string;
      }>("/api/pronunciation/import", f);
      p.change((project) => project.pronunciation.push(...result.rules));
      setEditing(true);
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
  return (
    <>
      <section
        className="pronunciation-manager pronunciation-library"
        aria-label="Pronunciation Dictionaries"
      >
        <label>
          Dictionary
          <select
            aria-label="Selected Pronunciation Dictionary"
            value={dictionary}
            onChange={(e) => setDictionary(e.target.value)}
          >
            <option value="">All Dictionaries</option>
            {dictionaries.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>

        <div className="pronunciation-actions">
          <button onClick={() => file.current?.click()} disabled={busy}>
            Import REX…
          </button>
          <button
            onClick={() => {
              const first = rules.find(
                (r) =>
                  !dictionary || (r.dictionary || "My Rules") === dictionary,
              );
              if (
                first &&
                (!selected ||
                  !rules.some(
                    (r) =>
                      r.id === selected &&
                      (!dictionary ||
                        (r.dictionary || "My Rules") === dictionary),
                  ))
              )
                void choose(first);
              setEditing(true);
            }}
            data-help="Open the pronunciation dictionary in a large editor with its rule list, matching options and voice tests."
          >
            Edit Dictionary…
          </button>
        </div>
        <small>
          {
            rules.filter(
              (r) => !dictionary || (r.dictionary || "My Rules") === dictionary,
            ).length
          }{" "}
          Rules
        </small>
      </section>
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

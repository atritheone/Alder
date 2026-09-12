import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Square,
  Plus,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Columns3,
  AlignJustify,
  BookOpen,
  FileText,
  Volume2,
  Repeat2,
  Settings2,
  Download,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  Search,
  Check,
  X,
  Link,
  GitBranch,
  Copy,
  Scissors,
  Combine,
  Trash2,
  SlidersHorizontal,
  AudioLines,
  Leaf,
  CircleHelp,
  LoaderCircle,
  AlertCircle,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import type {
  Project,
  Clip,
  Idea,
  Job,
  Voice,
  Analysis,
  Lexicon,
  DocNode,
  Track,
} from "./types";
import {
  api,
  upload,
  download,
  mediaUrl,
  uid,
  textDoc,
  newClip,
  chosenClip,
  words,
  collatedText,
  duration,
} from "./api";
import { useProject } from "./useProject";
import Browser, { deviceCatalog } from "./Browser";
import BookWorkspace from "./BookWorkspace";
import { bookText, newChapter } from "./book";
import Editor, { type EditorHandle } from "./Editor";
import DefinitionStudio from "./DefinitionStudio";
import RulesManager from "./RulesManager";
import NarrationReview from "./NarrationReview";
import StylesManager from "./StylesManager";
import SpeechOptions, { DEFAULT_SPEECH_OPTIONS } from "./SpeechOptions";

import StartScreen, { NewDocument } from "./StartScreen";
import { openDocuments } from "./openDocuments";
import { helpFor } from "./contextHelp";
import { useNarrationGain } from "./audioPlayback";
import PlaybackSpeed from "./PlaybackSpeed";

type Field = {
  name: string;
  label: string;
  value?: string | number;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
};
type FormSpec = {
  title: string;
  description?: string;
  fields: Field[];
  submit: string;
  action: (values: Record<string, string>) => Promise<void> | void;
  danger?: { label: string; action: () => void };
};
function FormDialog({
  spec,
  onClose,
  onError,
}: {
  spec: FormSpec;
  onClose: () => void;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="modal-backdrop form-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="modal"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const values = Object.fromEntries(
            new FormData(e.currentTarget).entries(),
          ) as Record<string, string>;
          try {
            await spec.action(values);
            onClose();
          } catch (e) {
            onError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <strong>{spec.title}</strong>
          <button type="button" aria-label="Close dialog" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {spec.description && <p>{spec.description}</p>}
        <div className="modal-fields">
          {spec.fields.map((f) => (
            <label key={f.name}>
              {f.label}
              {f.options ? (
                <select
                  aria-label={f.label}
                  name={f.name}
                  defaultValue={f.value}
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  name={f.name}
                  defaultValue={f.value}
                  required={f.required}
                  rows={4}
                />
              ) : (
                <input
                  name={f.name}
                  type={f.type || "text"}
                  defaultValue={f.value}
                  required={f.required}
                  autoFocus={f === spec.fields[0]}
                />
              )}
            </label>
          ))}
        </div>
        <footer>
          {spec.danger && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                spec.danger!.action();
                onClose();
              }}
            >
              {spec.danger.label}
            </button>
          )}
          <span />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="accent" disabled={busy} type="submit">
            {busy ? "Working…" : spec.submit}
          </button>
        </footer>
      </form>
    </div>
  );
}

function savedChoice(key: string, choices: string[], fallback: string) {
  const value = localStorage.getItem(key);
  return value && choices.includes(value) ? value : fallback;
}
function savedNumber(key: string, fallback: number, min: number, max: number) {
  const raw = localStorage.getItem(key),
    value = raw === null ? fallback : Number(raw);
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}
export default function App() {
  const { project, change, load, flush, saveState, error, setError, history } =
    useProject();
  const [newOpen, setNewOpen] = useState(false);
  const [narrationVolume, setNarrationVolume] = useState(2);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpText, setHelpText] = useState(
    "Hover over a control or focus it with the keyboard to learn what it does.",
  );
  const [dropping, setDropping] = useState(false);
  const [verifySpeech, setVerifySpeech] = useState(false),
    [audioFormat, setAudioFormat] = useState("wav");
  const [completion, setCompletion] = useState<string[]>([]);
  const [view, setView] = useState(() =>
      savedChoice("alder.view", ["Write", "Pages", "Page Preview"], "Write"),
    ),
    [detail, setDetail] = useState(() =>
      savedChoice("alder.detail", ["Clip", "Devices", "Narration"], "Clip"),
    ),
    [selected, setSelected] = useState<string | null>(null),
    [ideas, setIdeas] = useState<Idea[]>([]),
    [voices, setVoices] = useState<Voice[]>([
      { id: "default", name: "Built-in voice" },
    ]),
    [jobs, setJobs] = useState<Job[]>([]),
    [capabilities, setCapabilities] = useState<any>(null);
  const [browserOpen, setBrowserOpen] = useState(
      () => localStorage.getItem("alder.browserOpen") === "true",
    ),
    [detailOpen, setDetailOpen] = useState(
      () => localStorage.getItem("alder.detailOpen") === "true",
    ),
    [structure, setStructure] = useState(false),
    [loop, setLoop] = useState(false),
    [speed, setSpeed] = useState(1),
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [audioDuration, setAudioDuration] = useState(0),
    [activeJob, setActiveJob] = useState<Job | null>(null),
    [hint, setHint] = useState(""),
    [word, setWord] = useState("I"),
    [selection, setSelection] = useState(""),
    [lexicon, setLexicon] = useState<Lexicon | null>(null),
    [lexTab, setLexTab] = useState("Alternatives"),
    [candidate, setCandidate] = useState(""),
    [analysis, setAnalysis] = useState<Analysis | null>(null),
    [form, setForm] = useState<FormSpec | null>(null),
    [panel, setPanel] = useState<string | null>(null),
    [menu, setMenu] = useState<string | null>(null),
    [projectList, setProjectList] = useState<
      { id: string; name: string; updatedAt: string }[]
    >([]),
    [exportResult, setExportResult] = useState<any>(null),
    [busy, setBusy] = useState(""),
    [seed, setSeed] = useState(42),
    [previewRevision, setPreviewRevision] = useState(0),
    [devicePreview, setDevicePreview] = useState<{
      type: string;
      text: string;
      original: string;
    } | null>(null);
  const [uiScale, setUiScale] = useState(() =>
      savedChoice("alder.uiScale", ["1", "1.15", "1.3"], "1"),
    ),
    [contrast, setContrast] = useState(
      () => localStorage.getItem("alder.highContrast") === "true",
    ),
    [browserWidth, setBrowserWidth] = useState(() =>
      savedNumber("alder.browserWidth", 342, 240, 800),
    ),
    [detailHeight, setDetailHeight] = useState(() =>
      savedNumber("alder.bookSandboxHeight", 230, 180, 700),
    );
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [writingFocus, setWritingFocus] = useState(true);
  const bookEditor = useRef<EditorHandle>(null);
  const editor = useRef<EditorHandle>(null),
    audio = useRef<HTMLAudioElement>(null),
    importFile = useRef<HTMLInputElement>(null),
    imageFile = useRef<HTMLInputElement>(null),
    voiceFile = useRef<HTMLInputElement>(null),
    lastPlayed = useRef(""),
    root = useRef<HTMLDivElement>(null);
  const resumeAudio = useNarrationGain(audio, narrationVolume);
  useEffect(() => {
    document.title = project
      ? `${project.name} — Alder · Organic Language Engine`
      : "Alder · Organic Language Engine";
  }, [project?.name]);
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDropping(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      setDropping(false);
      const files = Array.from(e.dataTransfer.files);
      void (async () => {
        setBusy("Opening files…");
        try {
          await flush();
          const opened = await openDocuments(files);
          if (opened) {
            load(opened);
            setView("Write");
            setPanel(null);
            setNewOpen(false);
          }
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy("");
        }
      })();
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop, true);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop, true);
    };
  }, [flush, load, setError]);
  const clip = project?.clips.find((c) => c.id === selected) || null,
    track = project?.tracks.find((t) => t.id === clip?.trackId) || null,
    content = clip ? chosenClip(clip) : null;
  const chapter =
    project?.book?.chapters.find((c) => c.id === chapterId) ||
    project?.book?.chapters[0];
  const activeContent = writingFocus && chapter ? chapter : content;
  const targetEditor = () =>
    writingFocus ? bookEditor.current : editor.current;
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [setError],
  );
  useEffect(() => {
    api<{ ideas: Idea[] }>("/api/ideas")
      .then((r) => setIdeas(r.ideas))
      .catch(() => {});
    api<{ voices: Voice[] }>("/api/speech/voices")
      .then((r) => setVoices(r.voices))
      .catch(() => {});
    api("/api/speech/capabilities")
      .then(setCapabilities)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (project && !project.clips.some((c) => c.id === selected))
      setSelected(project.clips[0]?.id || null);
  }, [project?.id, project?.clips.length, selected]);
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const get = async () => {
      try {
        const result = await api<{ jobs: Job[] }>(
          `/api/projects/${project.id}/speech`,
        );
        if (!cancelled) {
          setJobs(result.jobs);
          if (activeJob) {
            const updated = result.jobs.find((j) => j.id === activeJob.id);
            if (updated) setActiveJob(updated);
          }
        }
      } catch {}
    };
    void get();
    const id = setInterval(get, 1700);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [project?.id, activeJob?.id]);
  useEffect(() => {
    if (!activeJob) return;
    if (
      activeJob.audioUrl &&
      ["ready", "completed"].includes(activeJob.status) &&
      lastPlayed.current !== activeJob.id
    ) {
      lastPlayed.current = activeJob.id;
      if (audio.current) {
        audio.current.src = mediaUrl(activeJob.audioUrl);
        audio.current.playbackRate = speed;
        void audio.current
          .play()
          .catch(() => setHint("Audio is ready. Press Play to listen."));
      }
    }
  }, [activeJob]);
  useEffect(() => {
    if (audio.current) {
      audio.current.playbackRate = speed;
      audio.current.loop = loop;
    }
  }, [speed, loop]);
  useEffect(() => {
    setAnalysis(null);
    if (!activeContent || !project) {
      return;
    }
    let cancelled = false;
    const text = activeContent.text;
    const rules = track?.devices
      .filter(
        (d) =>
          d.enabled &&
          [
            "spelling",
            "repetition",
            "verbosity",
            "sentence_length",
            "terminology",
          ].includes(d.type),
      )
      .map((d) => d.type);
    const timer = setTimeout(() => {
      api<Analysis>("/api/analyze", "POST", {
        text,
        projectId: project.id,
        rules: rules?.length ? [...rules, "custom"] : undefined,
      })
        .then((a) => {
          if (!cancelled) setAnalysis(a);
        })
        .catch(() => {});
    }, 650);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeContent?.text,
    writingFocus,
    chapter?.id,
    clip?.id,
    clip?.activeVariantId,
    project?.id,
    track?.devices,
    project?.settings.customRules,
    project?.settings.ignoredRuleIds,
  ]);
  useEffect(() => {
    let cancelled = false;
    if (!word.trim()) {
      setLexicon(null);
      return;
    }
    const timer = setTimeout(
      () =>
        api<Lexicon>(
          `/api/lexicon?word=${encodeURIComponent(word)}&projectId=${project?.id || ""}`,
        )
          .then((r) => {
            if (!cancelled) setLexicon(r);
          })
          .catch(() => {}),
      200,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [word, project?.id, project?.dictionary]);
  useEffect(() => window.alder?.onCloseRequest(flush), [flush]);
  useEffect(() => {
    for (const [key, value] of Object.entries({
      view,
      detail,
      browserOpen,
      detailOpen,
      uiScale,
      highContrast: contrast,
      browserWidth,
      detailHeight,
    }))
      localStorage.setItem(`alder.${key}`, String(value));
    document.documentElement.style.setProperty("--ui-scale", uiScale);
  }, [
    view,
    detail,
    browserOpen,
    detailOpen,
    uiScale,
    contrast,
    browserWidth,
    detailHeight,
  ]);
  const selectClip = (id: string) => {
    setSelected(id);
    setDetailOpen(true);
    setCandidate("");
    setDevicePreview(null);
  };
  const updateContent = (document: DocNode, text: string) =>
    change((p) => {
      const c = p.clips.find((x) => x.id === selected);
      if (!c) return;
      const target = c.variants.find((v) => v.id === c.activeVariantId) || c;
      target.document = document;
      target.text = text;
    });
  const createClip = (
    trackId: string,
    slot: number,
    text = "",
    title = "Untitled draft",
  ) => {
    const id = uid();
    change((p) => {
      if (!trackId) {
        const t: Track = {
          id: uid(),
          name: "Language",
          color: "#9baeff",
          role: "Writing",
          voiceId: "default",
          muted: false,
          solo: false,
          devices: [],
        };
        p.tracks.push(t);
        trackId = t.id;
      }
      while (p.clips.some((c) => c.trackId === trackId && c.slot === slot))
        slot++;
      p.clips.push({ ...newClip(trackId, slot, text, title), id });
    });
    setSelected(id);
    setDetail("Clip");
    setDetailOpen(true);
    setWritingFocus(false);
    setTimeout(() => editor.current?.focus(), 50);
  };
  const newProject = () => {
    void run(async () => {
      await flush();
      setNewOpen(true);
    });
  };
  const collate = (id: string, sectionId?: string) => {
    const source = project?.clips.find((c) => c.id === id);
    if (!source) return;
    bookEditor.current?.insertDocument(chosenClip(source).document);
    setHint(
      "Inserted a copy into the chapter. The sandbox keeps its own wording.",
    );
  };
  const insertIdea = (idea: Idea) => {
    if (targetEditor()) {
      targetEditor()!.insert(idea.word);
      setHint(`Inserted “${idea.word}” from ${idea.category}.`);
    } else if (project)
      createClip(project.tracks[0]?.id || "", 0, idea.word, idea.word);
  };
  const addDevice = (type: string) => {
    const target = track || project?.tracks[0];
    if (target)
      change((p) =>
        p.tracks
          .find((t) => t.id === target.id)!
          .devices.push({ id: uid(), type, enabled: true, settings: {} }),
      );
    setDetail("Devices");
    setDetailOpen(true);
  };
  const startSpeech = async (
    id?: string,
    scope = "clip",
    overrideText?: string,
  ) => {
    if (!project) return;
    await flush();
    const c = project.clips.find((c) => c.id === (id || selected));
    const t = project.tracks.find((t) => t.id === c?.trackId);
    const request: any = {
      scope,
      seed,
      ...DEFAULT_SPEECH_OPTIONS,
      ...(project.settings.speechOptions || {}),
      verify: verifySpeech,
      format: audioFormat,
    };
    if (scope !== "collation")
      request.voiceId = c?.voiceId || t?.voiceId || "default";
    if (scope === "clip" && c) request.clipId = c.id;
    if (overrideText) request.text = overrideText;
    if (scope === "selection") {
      request.text = overrideText || selection || (c && chosenClip(c).text);
      if (!request.text) throw new Error("Select some text to read.");
    }
    if (scope === "clip" && !c)
      throw new Error("Create or select a draft first.");
    const job = await api<Job>(
      `/api/projects/${project.id}/speech`,
      "POST",
      request,
    );
    setActiveJob(job);
    setJobs((j) => [job, ...j.filter((x) => x.id !== job.id)]);
    setHint("Preparing local narration…");
  };
  const transport = () => {
    if (
      audio.current?.src &&
      activeJob &&
      ["ready", "completed"].includes(activeJob.status)
    ) {
      if (playing) audio.current.pause();
      else void audio.current.play().catch((e) => setError(e.message));
    } else void run(() => startSpeech(selected || undefined, "collation"));
  };
  const saveProject = async () => {
    if (!project) return;
    await flush();
    if (["txt", "docx"].includes(project.settings.documentKind)) {
      const format =
        project.settings.preferredFormat || project.settings.documentKind;
      const result = await api(`/api/projects/${project.id}/export`, "POST", {
        format,
      });
      await download(result.downloadUrl, `${project.name}.${format}`);
      setHint(`Saved ${project.name}.${format}`);
      return;
    }
    const path = window.alder ? await window.alder.savePath() : undefined;
    if (window.alder && !path) return;
    const result = await api(`/api/projects/${project.id}/save`, "POST", {
      path,
    });
    setHint(`Project saved to ${result.path}`);
  };
  const openPanel = (name: string) => {
    setMenu(null);
    if (!project && name === "projects") {
      window.dispatchEvent(new Event("alder-open-start"));
      return;
    }
    if (name === "import") {
      importFile.current?.click();
      return;
    }
    if (name === "projects")
      void api<{ projects: any[] }>("/api/projects").then((r) =>
        setProjectList(r.projects),
      );
    if (name === "ideas") {
      setForm({
        title: "Add an idea sample",
        description:
          "Ideas are reusable language samples. Categories describe concepts independently of grammar.",
        fields: [
          { name: "word", label: "Word or expression", required: true },
          {
            name: "category",
            label: "Category",
            value: "Prime",
            required: true,
          },
          { name: "pos", label: "Part of speech", value: "pronoun" },
          {
            name: "definition",
            label: "Definition or meaning",
            type: "textarea",
          },
          { name: "example", label: "Example in context" },
        ],
        submit: "Add sample",
        action: (v) =>
          change((p) =>
            p.ideas.push({
              id: uid(),
              word: v.word,
              category: v.category,
              pos: v.pos,
              definition: v.definition,
              examples: v.example ? [v.example] : [],
              tags: [],
            }),
          ),
      });
      return;
    }
    setPanel(name);
  };
  const duplicate = () => {
    if (!clip || !content) return;
    createClip(clip.trackId, clip.slot + 1, content.text, `${clip.title} copy`);
    change((p) => {
      const added = p.clips[p.clips.length - 1];
      added.document = structuredClone(content.document);
    });
  };
  const variant = () => {
    if (!clip || !content) return;
    const id = uid();
    change((p) => {
      const c = p.clips.find((c) => c.id === clip.id)!;
      c.variants.push({
        id,
        name: `Take ${c.variants.length + 2}`,
        document: structuredClone(content.document),
        text: content.text,
        createdAt: new Date().toISOString(),
      });
      c.activeVariantId = id;
    });
  };
  const splitClip = () => {
    if (!clip || !content) return;
    const blocks = content.document.content || [];
    if (blocks.length < 2) {
      setHint(
        "Split at a paragraph boundary: add a paragraph break at the split point first.",
      );
      return;
    }
    setForm({
      title: "Split draft",
      description:
        "Create two independent drafts at a paragraph boundary. The source draft, its takes, and existing collation placements are retained.",
      fields: [
        {
          name: "after",
          label: `Split after paragraph (1–${blocks.length - 1})`,
          value: Math.max(1, Math.floor(blocks.length / 2)),
          type: "number",
        },
      ],
      submit: "Create split drafts",
      action: (v) => {
        const index = Number(v.after);
        if (index < 1 || index >= blocks.length)
          throw new Error("Choose a paragraph boundary within this draft.");
        const firstId = uid();
        change((p) => {
          let slot =
            Math.max(
              ...p.clips
                .filter((c) => c.trackId === clip.trackId)
                .map((c) => c.slot),
              -1,
            ) + 1;
          const a = {
            ...newClip(clip.trackId, slot, "", `${clip.title} · first`),
            id: firstId,
            document: {
              type: "doc",
              content: structuredClone(blocks.slice(0, index)),
            },
          };
          const b = {
            ...newClip(clip.trackId, slot + 1, "", `${clip.title} · second`),
            document: {
              type: "doc",
              content: structuredClone(blocks.slice(index)),
            },
          };
          p.clips.push(a, b);
        });
        setSelected(firstId);
        setHint(
          "Two independent drafts created. Existing source and collation are unchanged.",
        );
      },
    });
  };
  const mergeClip = () => {
    if (!clip || !project) return;
    const next = project.clips
      .filter((c) => c.trackId === clip.trackId && c.slot > clip.slot)
      .sort((a, b) => a.slot - b.slot)[0];
    if (!next) {
      setHint(
        "Place another draft below this one on the same track to consolidate.",
      );
      return;
    }
    const id = uid();
    change((p) => {
      const a = p.clips.find((c) => c.id === clip.id)!,
        b = p.clips.find((c) => c.id === next.id)!;
      const slot =
        Math.max(
          ...p.clips
            .filter((c) => c.trackId === clip.trackId)
            .map((c) => c.slot),
          -1,
        ) + 1;
      p.clips.push({
        ...newClip(
          clip.trackId,
          slot,
          `${chosenClip(a).text}\n${chosenClip(b).text}`,
          `${clip.title} + ${next.title}`,
        ),
        id,
        document: {
          type: "doc",
          content: [
            ...structuredClone(chosenClip(a).document.content || []),
            ...structuredClone(chosenClip(b).document.content || []),
          ],
        },
      });
    });
    setSelected(id);
    setHint(
      "Created a combined draft. The source drafts, takes and collation placements are retained.",
    );
  };
  const findReplace = () =>
    setForm({
      title: "Find and replace",
      description:
        "Search the active chapter or sandbox draft. Replacements preserve surrounding formatting and can be undone.",
      fields: [
        { name: "find", label: "Find", value: word },
        { name: "replace", label: "Replace with" },
        {
          name: "mode",
          label: "Action",
          options: [
            { value: "find", label: "Find next" },
            { value: "replace", label: "Replace all" },
          ],
        },
      ],
      submit: "Apply",
      action: (v) => {
        if (!activeContent || !v.find) return;
        const start = targetEditor()?.getSelectionOffsets().end || 0;
        const next = activeContent.text.indexOf(v.find, start),
          at = next >= 0 ? next : activeContent.text.indexOf(v.find);
        if (at < 0) {
          setHint("No matching text.");
          return;
        }
        if (v.mode === "find")
          targetEditor()?.selectRange(at, at + v.find.length);
        else targetEditor()?.replaceAll(v.find, v.replace || "");
      },
    });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newProject();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openPanel("projects");
        return;
      }
      const editable = (e.target as HTMLElement).closest(
        "input,textarea,select,[contenteditable=true]",
      );
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void run(saveProject);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        findReplace();
      }
      if (!editable) {
        if (e.code === "Space") {
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent("alder-reading-command", { detail: "toggle" }),
          );
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "z") {
          e.preventDefault();
          void run(() => history(e.shiftKey ? "redo" : "undo"));
        }
      }
      if (e.key === "Escape") {
        setMenu(null);
        setForm(null);
        setPanel(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useEffect(
    () =>
      window.alder?.onCommand((command) => {
        if (command === "save") void run(saveProject);
        if (command === "new") newProject();
        if (command === "open") openPanel("projects");
        if (command === "export") openPanel("export");
      }),
    [project],
  );
  const doExport = async (format: string) => {
    if (!project) return;
    setBusy(`Building ${format.toUpperCase()}…`);
    setExportResult(null);
    try {
      await flush();
      const result = await api(`/api/projects/${project.id}/export`, "POST", {
        format,
        options: { includeGlossary: Boolean(project.settings.includeGlossary) },
      });
      setExportResult(result);
      setHint(`${format.toUpperCase()} export ready`);
    } finally {
      setBusy("");
    }
  };
  const onImage = async (file: File) => {
    if (!project) return;
    await flush();
    const asset = await upload(`/api/projects/${project.id}/assets`, file);
    load(await api(`/api/projects/${project.id}`));
    targetEditor()?.image(
      `/api/projects/${project.id}/assets/${asset.id}`,
      asset.id,
      file.name.replace(/\.[^.]+$/, ""),
    );
  };
  const resize = (e: React.MouseEvent, kind: "browser" | "detail") => {
    e.preventDefault();
    const startX = e.clientX,
      startY = e.clientY,
      el = root.current!,
      rect = el.getBoundingClientRect();
    const initial =
      kind === "browser"
        ? parseInt(getComputedStyle(el).getPropertyValue("--browser-width"))
        : parseInt(getComputedStyle(el).getPropertyValue("--detail-height"));
    const move = (e: MouseEvent) => {
      const val =
        kind === "browser"
          ? Math.min(
              rect.width * 0.45,
              Math.max(240, initial + e.clientX - startX),
            )
          : Math.min(
              rect.height * 0.65,
              Math.max(180, initial + startY - e.clientY),
            );
      el.style.setProperty(
        kind === "browser" ? "--browser-width" : "--detail-height",
        `${val}px`,
      );
    };
    const done = () => {
      const value = parseFloat(
        el.style.getPropertyValue(
          kind === "browser" ? "--browser-width" : "--detail-height",
        ),
      );
      if (Number.isFinite(value)) {
        if (kind === "browser") setBrowserWidth(value);
        else setDetailHeight(value);
      }
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", done);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", done);
  };
  if (!project)
    return (
      <>
        <StartScreen onOpen={load} />
        {newOpen && (
          <NewDocument
            onCreate={(p) => {
              load(p);
              setNewOpen(false);
            }}
            onClose={() => setNewOpen(false)}
          />
        )}{" "}
        {dropping && (
          <div className="file-drop-overlay">Drop files to open in Alder</div>
        )}
        {busy && (
          <div className="open-progress" role="status">
            {busy}
          </div>
        )}
        {error && (
          <div className="open-progress" role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
      </>
    );
  const menuItems: Record<string, { label: string; action: () => void }[]> = {
    File: [
      { label: "New project…", action: newProject },
      { label: "Open project…", action: () => openPanel("projects") },
      {
        label: ["txt", "docx"].includes(project.settings.documentKind)
          ? "Save document…"
          : "Save project…",
        action: () => void run(saveProject),
      },
      { label: "Import document…", action: () => openPanel("import") },
      { label: "Export…", action: () => openPanel("export") },
    ],
    Edit: [
      {
        label: "Undo project change",
        action: () => void run(() => history("undo")),
      },
      {
        label: "Redo project change",
        action: () => void run(() => history("redo")),
      },
      { label: "Find and replace…", action: findReplace },
      { label: "Project dictionary…", action: () => openPanel("dictionary") },
    ],
    Create: [
      {
        label: "Sandbox draft",
        action: () =>
          createClip(
            track?.id || project.tracks[0]?.id || "",
            clip ? clip.slot + 1 : 0,
          ),
      },
      {
        label: "Chapter",
        action: () => {
          const c = newChapter(
            `Chapter ${(project.book?.chapters.length || 0) + 1}`,
          );
          change((p) => p.book!.chapters.push(c));
          setChapterId(c.id);
          setView("Write");
        },
      },

      { label: "Idea sample…", action: () => openPanel("ideas") },
      { label: "Definition card…", action: () => openPanel("definitions") },
    ],
    Read: [
      {
        label: "Pause / resume reading",
        action: () =>
          window.dispatchEvent(
            new CustomEvent("alder-reading-command", { detail: "toggle" }),
          ),
      },
      {
        label: "Read selection",
        action: () => void run(() => startSpeech(undefined, "selection")),
      },
      { label: "Voices and pronunciation…", action: () => openPanel("voices") },
      {
        label: "Narration queue",
        action: () => {
          setDetail("Narration");
          setDetailOpen(true);
        },
      },
    ],
    View: [
      {
        label: browserOpen ? "Hide browser" : "Show browser",
        action: () => setBrowserOpen((v) => !v),
      },
      {
        label: detailOpen ? "Hide sandbox" : "Show sandbox",
        action: () => setDetailOpen((v) => !v),
      },
      {
        label: structure ? "Hide structure" : "Show structure",
        action: () => setStructure((v) => !v),
      },
      { label: "Accessibility…", action: () => openPanel("accessibility") },
    ],
    Options: [
      { label: "Document setup…", action: () => openPanel("settings") },
      { label: "Styles…", action: () => openPanel("styles") },
      { label: "Language rules…", action: () => openPanel("rules") },
      { label: "Project assets…", action: () => openPanel("assets") },
    ],
    Help: [
      { label: "Getting started", action: () => openPanel("help") },
      { label: "About Alder", action: () => openPanel("about") },
    ],
  };
  return (
    <div
      className={"alder-app theme-neutral" + (contrast ? " high-contrast" : "")}
      onMouseOver={(e) => {
        if (helpOpen) {
          const text = helpFor(e.target);
          if (text) setHelpText(text);
        }
      }}
      onFocusCapture={(e) => {
        if (helpOpen) {
          const text = helpFor(e.target);
          if (text) setHelpText(text);
        }
      }}
      ref={root}
      style={
        {
          "--browser-width": `${browserWidth}px`,
          "--detail-height": `${detailHeight}px`,
        } as React.CSSProperties
      }
    >
      <div className="menubar">
        <strong className="window-brand" title="Organic Language Engine">
          Alder
        </strong>
        {Object.entries(menuItems).map(([name, items]) => (
          <div className="menu-wrap" key={name}>
            <button
              className={menu === name ? "open" : ""}
              onClick={() => setMenu(menu === name ? null : name)}
            >
              {name}
            </button>
            {menu === name && (
              <div className="menu-popup">
                {items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      setMenu(null);
                      item.action();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <span className="window-document">
          {project.name} <small>· Organic Language Engine</small>
        </span>
        <button
          title="Undo project change"
          aria-label="Undo project change"
          onClick={() => void run(() => history("undo"))}
        >
          <Undo2 size={13} />
        </button>
        <button
          title="Redo project change"
          aria-label="Redo project change"
          onClick={() => void run(() => history("redo"))}
        >
          <Redo2 size={13} />
        </button>
        <button
          title={
            ["txt", "docx"].includes(project.settings.documentKind)
              ? "Save document"
              : "Save project"
          }
          aria-label={
            ["txt", "docx"].includes(project.settings.documentKind)
              ? "Save document"
              : "Save project"
          }
          onClick={() => void run(saveProject)}
        >
          <Save size={13} />
        </button>
      </div>
      <div className="writing-commandbar">
        <button onClick={() => importFile.current?.click()}>
          <FolderOpen size={14} />
          Open document
        </button>
        <button
          onClick={() =>
            void run(async () => {
              const text = window.alder?.readClipboard
                ? await window.alder.readClipboard()
                : await navigator.clipboard.readText();
              if (!text.trim())
                throw new Error("The clipboard contains no text.");
              const c = newChapter("Clipboard", textDoc(text));
              change((p) => p.book!.chapters.push(c));
              setChapterId(c.id);
              setView("Write");
            })
          }
        >
          <Copy size={14} />
          Clipboard
        </button>
        <button onClick={() => openPanel("styles")}>
          <FileText size={14} />
          Styles
        </button>
        <button onClick={() => openPanel("settings")}>
          <Settings2 size={14} />
          Page setup
        </button>
        <button
          onClick={() => {
            const c = newChapter(
              `Chapter ${project.book!.chapters.length + 1}`,
            );
            change((p) => p.book!.chapters.push(c));
            setChapterId(c.id);
            setView("Write");
          }}
        >
          <Plus size={14} />
          Chapter
        </button>
        <span>
          {project.book?.chapters.length || 0} chapters ·{" "}
          {words(bookText(project))} words
        </span>
        <button onClick={() => openPanel("export")}>
          <Download size={14} />
          {["txt", "docx"].includes(project.settings.documentKind)
            ? "Export document"
            : "Export book"}
        </button>
      </div>
      <div className="workspaces">
        <div className="workspace-topline">
          <div className="project-label">
            <span className="project-dot" />
            <strong>{project.name}</strong>
            <button
              title="Rename project"
              onClick={() =>
                setForm({
                  title: "Rename project",
                  fields: [
                    {
                      name: "name",
                      label: "Project name",
                      value: project.name,
                      required: true,
                    },
                  ],
                  submit: "Rename",
                  action: (v) =>
                    change((p) => {
                      p.name = v.name;
                    }),
                })
              }
            >
              <ChevronDown size={12} />
            </button>
          </div>
          <div className="view-tabs" role="tablist">
            {[
              { name: "Write", icon: FileText },
              { name: "Pages", icon: Columns3 },
              { name: "Page Preview", icon: FileText },
            ].map(({ name, icon: Icon }) => (
              <button
                role="tab"
                aria-selected={view === name}
                key={name}
                className={view === name ? "active" : ""}
                onClick={() => {
                  if (name === "Page Preview")
                    void run(async () => {
                      await flush();
                      setPreviewRevision((n) => n + 1);
                      setView(name);
                    });
                  else setView(name);
                }}
              >
                <Icon size={13} />
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="upper-workspace">
          {browserOpen && (
            <>
              <Browser
                project={project}
                ideas={ideas}
                onInsert={insertIdea}
                onSelectClip={selectClip}
                onAddDevice={addDevice}
                onPanel={openPanel}
                onHint={setHint}
              />
              <div
                className="vertical-resizer"
                onMouseDown={(e) => resize(e, "browser")}
              />
            </>
          )}
          <BookWorkspace
            key={project.id}
            project={project}
            change={change}
            flush={flush}
            view={view}
            chapterId={chapterId}
            onChapter={(id) => {
              setChapterId(id);
              setWritingFocus(true);
              setAnalysis(null);
            }}
            editorRef={bookEditor}
            onSelection={(w, selection) => {
              setWord(w);
              setSelection(selection);
              setCandidate("");
            }}
            onFocus={() => setWritingFocus(true)}
            onComplete={() =>
              api<{ suggestions: string[] }>(
                `/api/complete?prefix=${encodeURIComponent(word)}&projectId=${project.id}`,
              )
                .then((r) => setCompletion(r.suggestions))
                .catch((e) => setError(e.message))
            }
            onImage={() => imageFile.current?.click()}
            onLink={() =>
              setForm({
                title: "Insert link",
                fields: [
                  {
                    name: "url",
                    label: "URL",
                    value: "https://",
                    required: true,
                  },
                  {
                    name: "label",
                    label: "Link text",
                    value: selection || word,
                  },
                ],
                submit: "Insert",
                action: (v) => {
                  if (!/^https?:\/\//i.test(v.url))
                    throw new Error("Use an http or https link.");
                  bookEditor.current?.link(v.label, v.url);
                },
              })
            }
            onRead={(c) =>
              void run(() => startSpeech(undefined, "selection", c.text))
            }
            annotations={writingFocus ? analysis?.annotations : undefined}
            previewKey={previewRevision}
            previewUrl={mediaUrl(
              `/api/projects/${project.id}/preview?r=${previewRevision}`,
            )}
          />
        </div>
      </div>
      <div
        className="horizontal-resizer"
        onMouseDown={(e) => resize(e, "detail")}
      />
      {detailOpen && (
        <section className="detail-pane pane">
          <div className="detail-heading">
            <div className="clip-name" style={{ borderLeftColor: "#888888" }}>
              {clip ? (
                <input
                  aria-label="Sandbox draft title"
                  value={clip.title}
                  onChange={(e) =>
                    change((p) => {
                      p.clips.find((c) => c.id === clip.id)!.title =
                        e.target.value;
                    })
                  }
                />
              ) : (
                <span>No sandbox draft selected</span>
              )}
            </div>
            <div className="detail-tabs" role="tablist">
              {["Clip", "Devices", "Narration"].map((t) => (
                <button
                  role="tab"
                  aria-selected={detail === t}
                  className={detail === t ? "active" : ""}
                  key={t}
                  onClick={() => setDetail(t)}
                >
                  {t === "Clip" ? (
                    <FileText size={12} />
                  ) : t === "Devices" ? (
                    <SlidersHorizontal size={12} />
                  ) : (
                    <AudioLines size={12} />
                  )}{" "}
                  {t === "Clip"
                    ? "Sandbox"
                    : t === "Devices"
                      ? "Language tools"
                      : t}
                </button>
              ))}
            </div>
            <span className="detail-spacer" />
            {clip && (
              <>
                <select
                  aria-label="Draft version"
                  value={clip.activeVariantId || ""}
                  onChange={(e) =>
                    change((p) => {
                      p.clips.find((c) => c.id === clip.id)!.activeVariantId =
                        e.target.value || null;
                    })
                  }
                >
                  <option value="">Original</option>
                  {clip.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <button
                  title="Create draft version"
                  aria-label="Create draft version"
                  onClick={variant}
                >
                  <GitBranch size={13} />
                </button>
                <button
                  title="Duplicate draft"
                  aria-label="Duplicate draft"
                  onClick={duplicate}
                >
                  <Copy size={13} />
                </button>
                <button
                  title="Split draft"
                  aria-label="Split draft"
                  onClick={splitClip}
                >
                  <Scissors size={13} />
                </button>
                <button
                  title="Combine with next draft"
                  aria-label="Combine drafts"
                  onClick={mergeClip}
                >
                  <Combine size={13} />
                </button>
                <button
                  className="add-collation"
                  onClick={() => collate(clip.id)}
                >
                  Insert into chapter <ArrowRight size={12} />
                </button>
              </>
            )}
          </div>
          {detail === "Clip" ? (
            clip && content ? (
              <div className="clip-detail">
                <aside className="clip-properties">
                  <div className="property-caption">DRAFT</div>
                  <div className="property-grid">
                    <label>
                      Words<output>{words(content.text)}</output>
                    </label>
                    <label>
                      Sentences<output>{analysis?.sentences || 0}</output>
                    </label>
                  </div>
                  <label>
                    Collection
                    <select
                      value={clip.trackId}
                      onChange={(e) =>
                        change((p) => {
                          const c = p.clips.find((c) => c.id === clip.id)!;
                          c.trackId = e.target.value;
                          while (
                            p.clips.some(
                              (o) =>
                                o.id !== c.id &&
                                o.trackId === c.trackId &&
                                o.slot === c.slot,
                            )
                          )
                            c.slot++;
                        })
                      }
                    >
                      {project.tracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Voice
                    <select
                      aria-label="Draft voice"
                      value={clip.voiceId || ""}
                      onChange={(e) =>
                        change((p) => {
                          p.clips.find((c) => c.id === clip.id)!.voiceId =
                            e.target.value || null;
                        })
                      }
                    >
                      <option value="">Default voice</option>
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Variation seed
                    <input
                      type="number"
                      value={seed}
                      onChange={(e) => setSeed(Number(e.target.value))}
                    />
                  </label>
                  <div className="clip-read-estimate">
                    ≈{" "}
                    {duration(
                      analysis?.readingSeconds || words(content.text) / 3,
                    )}
                    <small>estimated reading</small>
                  </div>
                  <button
                    className="wide amber"
                    onClick={() => void run(() => startSpeech(clip.id))}
                  >
                    <Play size={12} />
                    Read draft
                  </button>
                  <button
                    className="wide subtle"
                    onClick={() =>
                      setForm({
                        title: "Delete draft",
                        description:
                          "This removes the sandbox draft. Text already copied into the book is retained. You can undo the change.",
                        fields: [],
                        submit: "Delete draft",
                        action: () =>
                          change((p) => {
                            p.clips = p.clips.filter((c) => c.id !== clip.id);
                            p.placements = p.placements.filter(
                              (x) => x.clipId !== clip.id,
                            );
                          }),
                      })
                    }
                  >
                    <Trash2 size={11} />
                    Delete draft
                  </button>
                </aside>
                <Editor
                  ref={editor}
                  onFocus={() => setWritingFocus(false)}
                  document={content.document}
                  identity={`${clip.id}:${clip.activeVariantId || "original"}`}
                  onChange={updateContent}
                  onSelection={(w, s) => {
                    setWord(w);
                    setSelection(s);
                    setCandidate("");
                  }}
                  annotations={
                    !writingFocus ? analysis?.annotations : undefined
                  }
                  showStructure={structure}
                  onToggleStructure={() => setStructure((v) => !v)}
                  onImage={() => imageFile.current?.click()}
                  onComplete={() => {
                    api<{ suggestions: string[] }>(
                      `/api/complete?prefix=${encodeURIComponent(word)}&projectId=${project.id}`,
                    )
                      .then((r) => setCompletion(r.suggestions))
                      .catch((e) => setError(e.message));
                  }}
                  onLink={() =>
                    setForm({
                      title: "Insert link",
                      fields: [
                        {
                          name: "url",
                          label: "URL",
                          value: "https://",
                          required: true,
                        },
                        {
                          name: "label",
                          label: "Link text",
                          value: selection || word,
                        },
                      ],
                      submit: "Insert",
                      action: (v) => {
                        if (!/^https?:\/\//i.test(v.url))
                          throw new Error("Use an http or https link.");
                        targetEditor()?.link(v.label, v.url);
                      },
                    })
                  }
                  styles={project.styles}
                  fontFamily={project.settings.fontFamily}
                />
                <aside className="word-workbench">
                  <div className="word-heading">
                    <BookOpen size={13} />
                    <input
                      aria-label="Explore word"
                      value={word}
                      onChange={(e) => setWord(e.target.value)}
                    />
                    <button
                      title="Add word to dictionary"
                      aria-label="Add word to dictionary"
                      onClick={() => {
                        if (word)
                          change((p) => {
                            if (!p.dictionary.some((d) => d.word === word))
                              p.dictionary.push({
                                word,
                                definition: lexicon?.definitions[0] || "",
                                preferred: null,
                              });
                          });
                      }}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                  <div className="word-tabs">
                    {["Alternatives", "Forms", "Definition", "Checks"].map(
                      (t) => (
                        <button
                          key={t}
                          className={lexTab === t ? "active" : ""}
                          onClick={() => setLexTab(t)}
                        >
                          {t === "Clip"
                            ? "Sandbox"
                            : t === "Devices"
                              ? "Language tools"
                              : t}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="word-results">
                    {lexTab === "Checks" ? (
                      analysis?.annotations.length ? (
                        analysis.annotations.map((a) => (
                          <div className="check-item" key={a.id}>
                            <button
                              onClick={() =>
                                targetEditor()?.selectRange(a.start, a.end)
                              }
                            >
                              <span className="check-type">{a.type}</span>
                              {a.message}
                            </button>
                            {a.suggestion && (
                              <button
                                className="suggestion-button"
                                onClick={() =>
                                  targetEditor()?.replaceRange(
                                    a.start,
                                    a.end,
                                    a.suggestion!,
                                  )
                                }
                              >
                                Use “{a.suggestion}”
                              </button>
                            )}
                            <button
                              className="ignore-rule"
                              onClick={() =>
                                setAnalysis((a0) =>
                                  a0
                                    ? {
                                        ...a0,
                                        annotations: a0.annotations.filter(
                                          (x) => x.id !== a.id,
                                        ),
                                      }
                                    : a0,
                                )
                              }
                            >
                              Ignore once
                            </button>
                            {a.ruleId && (
                              <button
                                className="ignore-rule"
                                onClick={() =>
                                  change((p) => {
                                    p.settings.ignoredRuleIds = [
                                      ...(p.settings.ignoredRuleIds || []),
                                      a.ruleId,
                                    ];
                                  })
                                }
                              >
                                Ignore rule in project
                              </button>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="no-findings">
                          <Check size={20} />
                          <p>No findings in this text.</p>
                        </div>
                      )
                    ) : lexTab === "Definition" ? (
                      <>
                        {lexicon?.definitions.map((d, i) => (
                          <p className="definition" key={i}>
                            {i + 1}. {d}
                          </p>
                        ))}
                        <button
                          className="wide"
                          onClick={() => openPanel("definitions")}
                        >
                          Create definition card…
                        </button>
                        {!lexicon?.definitions.length && (
                          <p className="empty-small">
                            No local definition. Add one to the project
                            dictionary.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="word-result-label">
                          {lexTab === "Forms" ? "Word forms" : "Synonyms"}
                        </div>
                        <div className="word-chips">
                          {(lexTab === "Forms"
                            ? lexicon?.forms
                            : lexicon?.synonyms
                          )?.map((s, i) => (
                            <button
                              key={s + i}
                              className={candidate === s ? "chosen" : ""}
                              onClick={() => setCandidate(s)}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                        {lexTab === "Alternatives" &&
                          !!lexicon?.antonyms.length && (
                            <>
                              <div className="word-result-label">Antonyms</div>
                              <div className="word-chips">
                                {lexicon.antonyms.map((s) => (
                                  <button
                                    key={s}
                                    className={candidate === s ? "chosen" : ""}
                                    onClick={() => setCandidate(s)}
                                  >
                                    {s}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        {lexTab === "Alternatives" &&
                          !!lexicon?.suggestions.length && (
                            <>
                              <div className="word-result-label">Spelling</div>
                              <div className="word-chips">
                                {lexicon.suggestions.map((s) => (
                                  <button
                                    key={s}
                                    onClick={() => setCandidate(s)}
                                  >
                                    {s}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        {!lexicon?.synonyms.length &&
                          !lexicon?.forms.length && (
                            <p className="empty-small">
                              Select a word in the editor to explore its meaning
                              and alternatives.
                            </p>
                          )}
                      </>
                    )}
                  </div>
                  {candidate && (
                    <div className="candidate-preview">
                      <div>
                        <span>{word}</span>
                        <ArrowRight size={12} />
                        <strong>{candidate}</strong>
                      </div>
                      <button
                        title="Audition in context"
                        onClick={() =>
                          void run(() =>
                            startSpeech(
                              undefined,
                              "selection",
                              (activeContent?.text || "").replace(
                                word,
                                candidate,
                              ),
                            ),
                          )
                        }
                      >
                        <Volume2 size={12} />
                      </button>
                      <button
                        className="accent"
                        onClick={() => {
                          targetEditor()?.replace(candidate);
                          setCandidate("");
                        }}
                      >
                        Replace
                      </button>
                    </div>
                  )}
                </aside>
              </div>
            ) : (
              <div className="detail-empty">
                <FileText size={28} />
                <p>Create a sandbox draft to experiment with wording.</p>
                <button
                  onClick={() => createClip(project.tracks[0]?.id || "", 0)}
                >
                  New sandbox draft
                </button>
              </div>
            )
          ) : detail === "Devices" ? (
            <div
              className="devices-rack"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const type = e.dataTransfer.getData(
                  "application/x-alder-device",
                );
                if (type) addDevice(type);
              }}
            >
              {(track || project.tracks[0])?.devices.map((device, index) => (
                <article
                  className={
                    "device-card " + (!device.enabled ? "bypassed" : "")
                  }
                  key={device.id}
                >
                  <header>
                    <button
                      aria-label={`Toggle ${device.type}`}
                      className={device.enabled ? "device-on" : ""}
                      onClick={() =>
                        change((p) => {
                          const d = p.tracks
                            .find(
                              (t) => t.id === (track || project.tracks[0]).id,
                            )!
                            .devices.find((d) => d.id === device.id)!;
                          d.enabled = !d.enabled;
                        })
                      }
                    >
                      ●
                    </button>
                    <strong>
                      {deviceCatalog.find((d) => d.id === device.type)?.name ||
                        device.type}
                    </strong>
                    <button
                      title="Remove device"
                      onClick={() =>
                        change((p) => {
                          const t = p.tracks.find(
                            (t) => t.id === (track || project.tracks[0]).id,
                          )!;
                          t.devices = t.devices.filter(
                            (d) => d.id !== device.id,
                          );
                        })
                      }
                    >
                      <X size={11} />
                    </button>
                  </header>
                  <p>
                    {
                      deviceCatalog.find((d) => d.id === device.type)
                        ?.description
                    }
                  </p>
                  <label>
                    Scope
                    <output>{track?.name || project.tracks[0]?.name}</output>
                  </label>
                  <div className="device-state">
                    <span className={device.enabled ? "on" : ""} />
                    {device.enabled ? "Enabled" : "Bypassed"}
                  </div>
                  <footer>
                    <button
                      disabled={index === 0}
                      title="Move device left"
                      onClick={() =>
                        change((p) => {
                          const d = p.tracks.find(
                            (t) => t.id === (track || project.tracks[0]).id,
                          )!.devices;
                          [d[index - 1], d[index]] = [d[index], d[index - 1]];
                        })
                      }
                    >
                      ←
                    </button>
                    <button
                      disabled={!clip || !device.enabled}
                      onClick={() => {
                        if (device.type === "tts")
                          void run(() => startSpeech(clip?.id));
                        else if (
                          [
                            "spelling",
                            "repetition",
                            "verbosity",
                            "sentence_length",
                            "terminology",
                          ].includes(device.type)
                        ) {
                          setDetail("Clip");
                          setLexTab("Checks");
                        } else
                          void run(async () => {
                            if (!content) return;
                            const r = await api("/api/transform", "POST", {
                              text: content.text,
                              type: device.type,
                              settings: device.settings,
                            });
                            setDevicePreview({
                              type: device.type,
                              text: r.text,
                              original: content.text,
                            });
                          });
                      }}
                    >
                      Preview
                    </button>
                  </footer>
                </article>
              ))}
              <div className="device-drop">
                <SlidersHorizontal size={24} />
                <p>Drop language devices here</p>
                <select
                  aria-label="Add language device"
                  value=""
                  onChange={(e) => addDevice(e.target.value)}
                >
                  <option value="">Add a device…</option>
                  {deviceCatalog.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              {devicePreview && (
                <div className="device-preview">
                  <strong>Transformation preview</strong>
                  <textarea readOnly value={devicePreview.text} />
                  <div>
                    <button onClick={() => setDevicePreview(null)}>
                      Discard
                    </button>
                    <button
                      className="accent"
                      onClick={() => {
                        if (clip) {
                          const id = uid();
                          change((p) => {
                            const c = p.clips.find((c) => c.id === clip.id)!;
                            c.variants.push({
                              id,
                              name:
                                deviceCatalog.find(
                                  (d) => d.id === devicePreview.type,
                                )?.name || "Device take",
                              text: devicePreview.text,
                              document: textDoc(devicePreview.text),
                              createdAt: new Date().toISOString(),
                            });
                            c.activeVariantId = id;
                          });
                          setDevicePreview(null);
                          setDetail("Clip");
                        }
                      }}
                    >
                      Keep as a take
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="narration-panel">
              <div className="narration-controls">
                <strong>Narration</strong>
                <label>
                  Speed{" "}
                  <PlaybackSpeed
                    value={speed}
                    onChange={setSpeed}
                    label="Narration speed"
                  />
                  ×
                </label>
                <label>
                  Volume{" "}
                  <input
                    aria-label="Narration volume"
                    title={`${Math.round(narrationVolume * 100)}%`}
                    type="range"
                    min="0"
                    max="4"
                    step="0.01"
                    value={narrationVolume}
                    onChange={(e) => setNarrationVolume(Number(e.target.value))}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={verifySpeech}
                    onChange={(e) => setVerifySpeech(e.target.checked)}
                  />
                  Check spoken words locally
                </label>
                <label>
                  Audio format
                  <select
                    aria-label="Narration format"
                    value={audioFormat}
                    onChange={(e) => setAudioFormat(e.target.value)}
                  >
                    {["wav", "mp3", "flac"].map((f) => (
                      <option key={f} value={f}>
                        {f.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <SpeechOptions
                  options={{
                    ...DEFAULT_SPEECH_OPTIONS,
                    ...(project.settings.speechOptions || {}),
                  }}
                  onChange={(options) =>
                    change((p) => {
                      p.settings.speechOptions = options;
                    })
                  }
                />
                <p>
                  Audio follows a saved text revision. Completed chunks are
                  retained for resuming.
                </p>
                <button
                  className="accent"
                  onClick={() =>
                    void run(() => startSpeech(undefined, "collation"))
                  }
                >
                  <Play size={13} />
                  Render book
                </button>
                <button onClick={() => openPanel("voices")}>
                  Manage voices
                </button>
                <p className="quiet">
                  {capabilities?.device ||
                    capabilities?.engine ||
                    "Chatterbox Turbo"}{" "}
                  ·{" "}
                  {capabilities?.available === false
                    ? "Resource unavailable"
                    : "Local synthesis"}
                </p>
              </div>
              <div className="job-list">
                {!jobs.length && (
                  <div className="empty-small">
                    No narration jobs yet. Choose a chapter or draft to read.
                  </div>
                )}
                {jobs.map((job) => (
                  <div
                    className={
                      "job " + (activeJob?.id === job.id ? "selected" : "")
                    }
                    key={job.id}
                  >
                    <div>
                      <strong>{job.text.slice(0, 100) || "Narration"}</strong>
                      <span className="job-status">{job.status}</span>
                      {job.reviewStatus && (
                        <span className="job-status">
                          {job.reviewStatus.replaceAll("_", " ")}
                        </span>
                      )}
                      <span>
                        Revision {job.sourceRevision}
                        {job.sourceRevision !== project.revision
                          ? " · earlier project revision"
                          : ""}
                      </span>
                    </div>
                    <progress
                      max={1}
                      value={
                        job.progress > 1 ? job.progress / 100 : job.progress
                      }
                    />
                    <p>{job.error || job.message}</p>
                    <div className="job-actions">
                      <span>
                        {
                          job.chunks.filter(
                            (c) =>
                              c.status === "ready" || c.status === "completed",
                          ).length
                        }
                        /{job.chunks.length} chunks
                      </span>
                      {job.audioUrl && (
                        <>
                          <button
                            onClick={() => {
                              lastPlayed.current = "";
                              setActiveJob(job);
                            }}
                          >
                            Listen
                          </button>
                          <button
                            onClick={() =>
                              void download(
                                job.audioUrl!,
                                `${project.name}-narration.${job.format || "wav"}`,
                              )
                            }
                          >
                            Save {(job.format || "wav").toUpperCase()}
                          </button>
                        </>
                      )}
                      {[
                        "failed",
                        "cancelled",
                        "interrupted",
                        "canceled",
                      ].includes(job.status) && (
                        <button
                          onClick={() =>
                            void run(async () => {
                              setActiveJob(
                                await api(
                                  `/api/speech/jobs/${job.id}/resume`,
                                  "POST",
                                ),
                              );
                            })
                          }
                        >
                          Resume
                        </button>
                      )}
                      {[
                        "queued",
                        "preparing",
                        "generating",
                        "checking",
                        "running",
                      ].includes(job.status) && (
                        <button
                          onClick={() =>
                            void run(async () => {
                              await api(
                                `/api/speech/jobs/${job.id}/cancel`,
                                "POST",
                              );
                            })
                          }
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <NarrationReview
                      job={job}
                      onReview={async (request) => {
                        const updated = await api<Job>(
                          `/api/speech/jobs/${job.id}/review`,
                          "POST",
                          request,
                        );
                        setJobs((current) =>
                          current.map((item) =>
                            item.id === updated.id ? updated : item,
                          ),
                        );
                        setActiveJob((current) =>
                          current?.id === updated.id ? updated : current,
                        );
                      }}
                      currentTime={activeJob?.id === job.id ? time : undefined}
                      onPlayChunk={(url) => {
                        lastPlayed.current = job.id;
                        setActiveJob(job);
                        if (audio.current) {
                          audio.current.src = mediaUrl(url);
                          void audio.current
                            .play()
                            .catch((e) => setError(e.message));
                        }
                      }}
                      onSeek={(seconds) => {
                        if (!job.audioUrl || !audio.current) return;
                        lastPlayed.current = job.id;
                        setActiveJob(job);
                        const a = audio.current;
                        const url = mediaUrl(job.audioUrl);
                        if (a.getAttribute("src") !== url) {
                          a.addEventListener(
                            "loadedmetadata",
                            () => {
                              a.currentTime = seconds;
                              void a.play();
                            },
                            { once: true },
                          );
                          a.src = url;
                        } else {
                          a.currentTime = seconds;
                          void a.play();
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
      {helpOpen && (
        <aside className="context-help" aria-label="Context help">
          <strong>Help</strong>
          <p>{helpText}</p>
        </aside>
      )}
      <footer className="statusbar">
        <button
          aria-label="Toggle help area"
          title="Show or hide help for the control under your pointer"
          aria-expanded={helpOpen}
          className={helpOpen ? "active" : ""}
          onClick={() => setHelpOpen((v) => !v)}
        >
          <CircleHelp size={15} />
        </button>
        <span className="status-hint">{hint}</span>
        <span className="save-status">
          <span
            className={
              saveState === "All changes saved" ? "saved-dot" : "unsaved-dot"
            }
          />
          {saveState}
        </span>
        <span className="status-project-count">
          {words(bookText(project))} words
        </span>
        <button
          className={detailOpen ? "active" : ""}
          title={
            detailOpen
              ? "Hide the sandbox, language tools, and narration panel"
              : "Show the sandbox to try draft wording, explore language, and review narration"
          }
          data-help="Show or hide the sandbox: a separate area for draft wording, language tools, and narration. Your document remains unchanged until you insert a draft."
          aria-label="Toggle sandbox"
          aria-expanded={detailOpen}
          onClick={() => setDetailOpen((v) => !v)}
        >
          {detailOpen ? "▾" : "▴"}
        </button>
        <span>{clip?.title || "Alder"}</span>
      </footer>
      {newOpen && (
        <NewDocument
          onCreate={(p) => {
            load(p);
            setNewOpen(false);
            setView("Write");
            setDetailOpen(false);
            setBrowserOpen(false);
          }}
          onClose={() => setNewOpen(false)}
        />
      )}
      {dropping && (
        <div className="file-drop-overlay">Drop files to open in Alder</div>
      )}
      {completion.length > 0 && (
        <div className="completion-popup">
          <header>
            Complete word <button onClick={() => setCompletion([])}>×</button>
          </header>
          {completion.map((item) => (
            <button
              key={item}
              onClick={() => {
                targetEditor()?.replace(item);
                setCompletion([]);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
      <audio
        crossOrigin="anonymous"
        ref={audio}
        onPlay={() => {
          resumeAudio();
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setTime(audio.current?.currentTime || 0)}
        onLoadedMetadata={() => setAudioDuration(audio.current?.duration || 0)}
        onError={() =>
          setHint(
            "Audio could not be opened. Inspect the narration job for details.",
          )
        }
      />
      <input
        hidden
        ref={importFile}
        type="file"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length)
            void run(async () => {
              setBusy("Importing documents…");
              try {
                await flush();
                for (const file of files) {
                  const imported = await upload<Project>(
                    `/api/projects/${project.id}/import`,
                    file,
                  );
                  load(imported);
                  setChapterId(imported.book?.chapters.at(-1)?.id || null);
                }
                setView("Write");
              } finally {
                setBusy("");
              }
            });
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={imageFile}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void run(() => onImage(file));
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={voiceFile}
        type="file"
        accept="audio/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            void run(async () => {
              await upload("/api/speech/voices", file, {
                name: file.name.replace(/\.[^.]+$/, ""),
              });
              setVoices(
                (await api<{ voices: Voice[] }>("/api/speech/voices")).voices,
              );
            });
          e.target.value = "";
        }}
      />
      {form && (
        <FormDialog
          key={form.title}
          spec={form}
          onClose={() => setForm(null)}
          onError={setError}
        />
      )}
      {panel && panel !== "definitions" && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setPanel(null)}
        >
          <section
            className={
              "modal manager-modal " +
              (panel === "export" ? "export-modal" : "")
            }
            role="dialog"
            aria-modal="true"
            aria-label={panel}
          >
            <header>
              <strong>
                {(
                  {
                    rules: "Language rules",
                    settings: "Document setup",
                    voices: "Voices & pronunciation",
                    projects: "Projects",
                    dictionary: "Project dictionary",
                    styles: "Styles",
                    assets: "Project assets",
                    export: "Export book",
                    help: "Getting started",
                    about: "About Alder",
                    accessibility: "Accessibility",
                    templates: "Project templates",
                  } as Record<string, string>
                )[panel] || panel}
              </strong>
              <button aria-label="Close dialog" onClick={() => setPanel(null)}>
                <X size={16} />
              </button>
            </header>
            <div className="manager-content">
              {panel === "projects" && (
                <>
                  <div className="manager-actions">
                    <button
                      className="accent"
                      onClick={() => {
                        setPanel(null);
                        newProject();
                      }}
                    >
                      New project
                    </button>
                    <button
                      onClick={() => {
                        if (window.alder)
                          void run(async () => {
                            const path = await window.alder!.openPath();
                            if (path) {
                              await flush();
                              load(
                                await api("/api/projects/open", "POST", {
                                  path,
                                }),
                              );
                              setPanel(null);
                            }
                          });
                        else
                          setForm({
                            title: "Open Alder archive",
                            fields: [
                              {
                                name: "path",
                                label: "Full path to .alder project",
                                required: true,
                              },
                            ],
                            submit: "Open",
                            action: async (v) => {
                              await flush();
                              load(await api("/api/projects/open", "POST", v));
                              setPanel(null);
                            },
                          });
                      }}
                    >
                      Open .alder file…
                    </button>
                  </div>
                  {projectList.map((p) => (
                    <button
                      className="project-list-item"
                      key={p.id}
                      onClick={() =>
                        void run(async () => {
                          await flush();
                          load(await api(`/api/projects/${p.id}`));
                          setPanel(null);
                        })
                      }
                    >
                      <FolderOpen size={18} />
                      <strong>{p.name}</strong>
                      <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                      {p.id === project.id && <Check size={15} />}
                    </button>
                  ))}
                </>
              )}
              {panel === "rules" && (
                <RulesManager
                  project={project}
                  onChange={change}
                  onError={setError}
                />
              )}
              {panel === "settings" && (
                <div className="settings-grid">
                  {[
                    ["publisher", "Publisher"],
                    ["subject", "Subject"],
                    ["rights", "Rights statement"],
                    ["identifier", "Book identifier (ISBN or URI)"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        value={project.settings[key] || ""}
                        onChange={(e) =>
                          change((p) => {
                            p.settings[key] = e.target.value;
                          })
                        }
                      />
                    </label>
                  ))}
                  <label>
                    Ebook cover
                    <select
                      value={project.settings.coverAssetId || ""}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.coverAssetId = e.target.value || null;
                        })
                      }
                    >
                      <option value="">No cover</option>
                      {project.assets
                        .filter((asset) => asset.mime.startsWith("image/"))
                        .map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.name}
                          </option>
                        ))}
                    </select>
                    <small>Choose an image collected in Project assets.</small>
                  </label>
                  <label>
                    Author
                    <input
                      value={project.settings.author}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.author = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      value={project.settings.description}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.description = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    Page size
                    <select
                      value={project.settings.pageSize}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.pageSize = e.target.value;
                        })
                      }
                    >
                      {["A4", "A5", "Letter", "Legal", "6x9"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Orientation
                    <select
                      value={project.settings.orientation || "portrait"}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.orientation = e.target.value;
                        })
                      }
                    >
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </label>
                  <label>
                    Start page numbering at
                    <input
                      type="number"
                      min="1"
                      max="9999"
                      step="1"
                      value={project.settings.firstPageNumber || 1}
                      onChange={(e) => {
                        const n = e.target.valueAsNumber;
                        if (Number.isInteger(n) && n >= 1 && n <= 9999)
                          change((p) => {
                            p.settings.firstPageNumber = n;
                          });
                      }}
                    />
                  </label>
                  <label>
                    Margins (mm)
                    <input
                      type="number"
                      min="5"
                      max="60"
                      value={project.settings.marginMm}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.marginMm = Number(e.target.value);
                        })
                      }
                    />
                  </label>
                  <label>
                    Body font
                    <select
                      value={project.settings.fontFamily}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.fontFamily = e.target.value;
                        })
                      }
                    >
                      {[
                        "Sitka Text",
                        "Georgia",
                        "Arial",
                        "Times New Roman",
                        "Segoe UI",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Body size (pt)
                    <input
                      type="number"
                      min="8"
                      max="32"
                      value={project.settings.fontSize}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.fontSize = Number(e.target.value);
                        })
                      }
                    />
                  </label>
                  <label>
                    Line height
                    <input
                      type="number"
                      min="1"
                      max="3"
                      step=".1"
                      value={project.settings.lineHeight}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.lineHeight = Number(e.target.value);
                        })
                      }
                    />
                  </label>
                  <label>
                    Running header
                    <input
                      value={project.settings.header}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.header = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={project.settings.footer}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.footer = e.target.checked;
                        })
                      }
                    />
                    Page numbers in footer
                  </label>
                </div>
              )}
              {panel === "voices" && (
                <>
                  <p>
                    Reference voices are processed locally. Use a clean
                    recording longer than five seconds, ideally about ten
                    seconds.
                  </p>
                  <div className="manager-actions">
                    <button
                      className="accent"
                      onClick={() => voiceFile.current?.click()}
                    >
                      Add reference voice…
                    </button>
                  </div>
                  {voices.map((v) => (
                    <div className="voice-row" key={v.id}>
                      <AudioLines size={18} />
                      <strong>{v.name}</strong>
                      <span>
                        {v.id === "default"
                          ? "Included with Alder"
                          : "Reference voice"}
                      </span>
                      <button
                        onClick={() =>
                          void run(async () => {
                            const job = await api<Job>(
                              `/api/projects/${project.id}/speech`,
                              "POST",
                              {
                                scope: "selection",
                                text: "I listen to the language and leave room for the words to breathe.",
                                voiceId: v.id,
                                seed,
                              },
                            );
                            setActiveJob(job);
                            setPanel(null);
                            setDetail("Narration");
                          })
                        }
                      >
                        Audition
                      </button>
                    </div>
                  ))}
                  <h3>Pronunciation dictionary</h3>
                  <p>Spoken substitutions leave the written text unchanged.</p>
                  {project.pronunciation.map((entry) => (
                    <div className="dictionary-row" key={entry.id}>
                      <strong>{entry.word}</strong>
                      <ArrowRight size={13} />
                      <span>{entry.spoken}</span>
                      <button
                        onClick={() =>
                          change((p) => {
                            p.pronunciation = p.pronunciation.filter(
                              (x) => x.id !== entry.id,
                            );
                          })
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setForm({
                        title: "Add pronunciation",
                        fields: [
                          {
                            name: "word",
                            label: "Written word or expression",
                            required: true,
                          },
                          { name: "spoken", label: "Speak as", required: true },
                          {
                            name: "mode",
                            label: "Match",
                            value: "literal",
                            options: [
                              { value: "literal", label: "Literal wording" },
                              { value: "regex", label: "Regular expression" },
                            ],
                          },
                        ],
                        submit: "Add pronunciation",
                        action: (v) =>
                          change((p) =>
                            p.pronunciation.push({
                              id: uid(),
                              word: v.word,
                              spoken: v.spoken,
                              regex: v.mode === "regex",
                              caseSensitive: false,
                              voiceId: null,
                            }),
                          ),
                      })
                    }
                  >
                    Add pronunciation…
                  </button>
                </>
              )}
              {panel === "dictionary" && (
                <>
                  <p>
                    Your spelling exceptions, definitions, and preferred wording
                    stay with this project.
                  </p>
                  {project.dictionary.map((entry, i) => (
                    <div className="dictionary-row" key={entry.word + i}>
                      <strong>{entry.word}</strong>
                      <span>
                        {entry.definition}
                        {entry.preferred ? ` → ${entry.preferred}` : ""}
                      </span>
                      <button
                        onClick={() => {
                          setWord(entry.word);
                          setPanel("definitions");
                        }}
                      >
                        Card
                      </button>
                      <button
                        onClick={() =>
                          change((p) => {
                            p.dictionary.splice(i, 1);
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="accent"
                    onClick={() =>
                      setForm({
                        title: "Add dictionary entry",
                        fields: [
                          { name: "word", label: "Word", required: true },
                          {
                            name: "definition",
                            label: "Definition",
                            type: "textarea",
                          },
                          {
                            name: "preferred",
                            label: "Preferred replacement (optional)",
                          },
                        ],
                        submit: "Add word",
                        action: (v) =>
                          change((p) =>
                            p.dictionary.push({
                              word: v.word,
                              definition: v.definition,
                              preferred: v.preferred || null,
                            }),
                          ),
                      })
                    }
                  >
                    Add word…
                  </button>
                </>
              )}
              {panel === "styles" && (
                <StylesManager
                  project={project}
                  onChange={change}
                  onError={setError}
                  onApply={(id, kind) => {
                    targetEditor()?.style(id, kind);
                    setPanel(null);
                  }}
                />
              )}
              {panel === "assets" && (
                <>
                  {project.assets.length ? (
                    project.assets.map((a) => (
                      <div className="dictionary-row" key={a.id}>
                        <FileText size={15} />
                        <strong>{a.name}</strong>
                        <span>{a.mime}</span>
                      </div>
                    ))
                  ) : (
                    <p>
                      No project assets yet. Insert an image in a chapter or
                      sandbox draft to collect it with the project.
                    </p>
                  )}
                  <button onClick={() => imageFile.current?.click()}>
                    Insert image…
                  </button>
                </>
              )}
              {panel === "export" && (
                <>
                  <div className="export-summary">
                    <BookOpen size={30} />
                    <div>
                      <h2>{project.name}</h2>
                      <p>
                        {project.sections.length} sections ·{" "}
                        {project.book?.chapters.filter((c) => c.include).length}{" "}
                        included chapters · {words(collatedText(project))} words
                      </p>
                    </div>
                  </div>
                  <p>
                    Export the book in chapter order at its current saved
                    revision.
                  </p>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={Boolean(project.settings.includeGlossary)}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.includeGlossary = e.target.checked;
                        })
                      }
                    />
                    Append the project's authored definitions as a glossary
                  </label>
                  <div className="export-formats">
                    {[
                      {
                        format: "txt",
                        label: "Plain text",
                        sub: "Exact wording",
                      },
                      {
                        format: "md",
                        label: "Markdown",
                        sub: "Portable writing",
                      },
                      { format: "html", label: "HTML", sub: "Styled document" },
                      { format: "docx", label: "Word", sub: ".docx document" },
                      { format: "pdf", label: "PDF", sub: "Fixed pages" },
                      {
                        format: "epub",
                        label: "EPUB",
                        sub: "Reflowable ebook",
                      },
                      { format: "azw3", label: "AZW3", sub: "Kindle ebook" },
                    ].map((f) => (
                      <button
                        key={f.format}
                        disabled={!!busy}
                        onClick={() => void run(() => doExport(f.format))}
                      >
                        <FileText size={20} />
                        <strong>{f.label}</strong>
                        <span>{f.sub}</span>
                      </button>
                    ))}
                  </div>
                  {busy && (
                    <p className="build-progress">
                      <LoaderCircle className="spin" size={15} />
                      {busy}
                    </p>
                  )}
                  {exportResult && (
                    <div className="export-result">
                      <Check size={18} />
                      <strong>{exportResult.filename}</strong>
                      <button
                        className="accent"
                        onClick={() =>
                          void download(
                            exportResult.downloadUrl,
                            exportResult.filename,
                          )
                        }
                      >
                        Save export…
                      </button>
                      {exportResult.warnings?.map((w: string, i: number) => (
                        <p key={i}>{w}</p>
                      ))}
                      {exportResult.validation && (
                        <pre>
                          {JSON.stringify(exportResult.validation, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setPanel(null);
                      setView("Page Preview");
                      setPreviewRevision((n) => n + 1);
                    }}
                  >
                    Preview publication
                  </button>
                </>
              )}
              {panel === "templates" && (
                <>
                  <p>
                    Create a plain text document, a Word document, or a book
                    with its own page and chapter settings.
                  </p>
                  <button
                    className="accent"
                    onClick={() => {
                      setPanel(null);
                      newProject();
                    }}
                  >
                    Create from template…
                  </button>
                </>
              )}
              {panel === "accessibility" && (
                <div className="settings-grid">
                  <label>
                    Interface size
                    <select
                      value={uiScale}
                      onChange={(e) => setUiScale(e.target.value)}
                    >
                      <option value="1">Standard</option>
                      <option value="1.15">Large</option>
                      <option value="1.3">Larger</option>
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={contrast}
                      onChange={(e) => setContrast(e.target.checked)}
                    />
                    High contrast
                  </label>
                  <p>
                    Use the Write and Pages views to write and arrange your
                    book. Space controls playback outside text fields. Ctrl+S
                    saves; Ctrl+F finds text. Chapter and page navigation are
                    keyboard accessible.
                  </p>
                </div>
              )}
              {panel === "help" && (
                <div className="help-content">
                  <h2>A place to work with language.</h2>
                  <ol>
                    <li>
                      <strong>Write.</strong> Write continuous chapter text on
                      the main pages. Formatting, lists, tables, images and page
                      breaks belong to the document.
                    </li>
                    <li>
                      <strong>Shape the book.</strong> Add and reorder chapters
                      in the Book navigator. Use Pages to move the text on a
                      page into a new reading order.
                    </li>
                    <li>
                      <strong>Explore language.</strong> Select words in your
                      chapter to explore alternatives and definitions. Keep
                      experiments in independent sandbox drafts below.
                    </li>
                    <li>
                      <strong>Read.</strong> Open a document, choose Chatterbox
                      or a Windows SAPI voice, and follow the spoken words. Read
                      the chapter, book, selection or from the cursor.
                    </li>
                    <li>
                      <strong>Publish.</strong> Use Page Preview to inspect the
                      final typeset output, then export a document or narration.
                    </li>
                  </ol>
                  <p>
                    Changes are saved locally as you work. Save a .alder archive
                    to collect the project and its assets into a portable file.
                  </p>
                  <p>
                    Chapters contain continuous text. Pages flow automatically.
                    Moving pages preserves their current boundaries with page
                    breaks. The sandbox keeps independent drafts.
                  </p>
                </div>
              )}
              {panel === "about" && (
                <div className="about-panel">
                  <Leaf size={40} />
                  <h1>Alder</h1>
                  <p>Organic Language Engine · 0.1.0</p>
                  <p>
                    Language as material. A workstation for writing,
                    experimenting, collating, and listening.
                  </p>
                  <p>
                    TypeScript interface · Python engine · Local Chatterbox
                    speech
                  </p>
                </div>
              )}
            </div>
            <footer>
              <span />
              <button
                className="accent"
                onClick={() => {
                  setPanel(null);
                  void flush();
                }}
              >
                Done
              </button>
            </footer>
          </section>
        </div>
      )}
      {panel === "definitions" && (
        <DefinitionStudio
          project={project}
          initialWord={word}
          onChange={change}
          onClose={() => setPanel(null)}
          onError={setError}
        />
      )}
      {error && (
        <div className="error-toast" role="alert">
          <AlertCircle size={18} />
          <div>
            <strong>Alder needs attention</strong>
            <p>{error}</p>
          </div>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

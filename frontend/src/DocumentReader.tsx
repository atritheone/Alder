import { useEffect, useRef, useState, type RefObject } from "react";
import { BookmarkPlus, Download, Pause, Play, Square } from "lucide-react";
import { api, download, duration, mediaUrl } from "./api";
import type { Chapter, Job, Project, Voice } from "./types";
import type { EditorHandle } from "./Editor";

import { useNarrationGain } from "./audioPlayback";
import { spokenWord } from "./wordFollowing";
import PlaybackSpeed from "./PlaybackSpeed";

type Props = {
  project: Project;
  chapter: Chapter;
  editorRef: RefObject<EditorHandle | null>;
  flush: () => Promise<void>;
  change: (fn: (p: Project) => void) => void;
  onChapter: (id: string) => void;
  onHighlight: (range: { start: number; end: number } | null) => void;
};
type Snapshot = {
  chapters: { id: string; text: string; offset: number; base: number }[];
};
const utf16 = (text: string, codePoints: number) =>
  Array.from(text).slice(0, codePoints).join("").length;
export default function DocumentReader(p: Props) {
  const [voices, setVoices] = useState<Voice[]>([
      { id: "default", name: "Chatterbox Turbo", kind: "builtin" },
    ]),
    [voice, setVoice] = useState("default");
  const [active, setActive] = useState(false);
  const [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState("");
  const [scope, setScope] = useState("chapter"),
    [speed, setSpeed] = useState(1),
    [volume, setVolume] = useState(2);
  const [rate, setRate] = useState(0),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const [format, setFormat] = useState("wav");
  const [chunkIndex, setChunkIndex] = useState(0);
  const fullAudio = useRef(false),
    shouldPlay = useRef(true);
  const chunkStart = (job: Job, index: number) =>
    job.chunks[index]?.startSeconds ??
    job.chunks
      .slice(0, index)
      .reduce(
        (n, c) => n + (c.seconds || 0) + (job.settings?.pauseSeconds ?? 0.18),
        0,
      );
  const playable = !!job?.chunks.some((c) => c.status === "ready");
  const [pitch, setPitch] = useState(0);
  const audio = useRef<HTMLAudioElement>(null),
    snapshot = useRef<Snapshot | null>(null),
    loaded = useRef("");
  const resumeAudio = useNarrationGain(audio, volume);
  const [range, setRange] = useState<{ start: number; end: number } | null>(
    null,
  );
  useEffect(() => {
    setVoice(p.chapter.voiceId || "default");
  }, [p.chapter.id]);
  useEffect(() => {
    api<{ voices: Voice[] }>("/api/speech/voices")
      .then((r) => setVoices(r.voices))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (
      !job ||
      ["ready", "failed", "cancelled", "interrupted"].includes(job.status)
    )
      return;
    let cancelled = false;
    const timer = setInterval(
      () =>
        api<Job>(`/api/speech/jobs/${job.id}`)
          .then((next) => {
            if (!cancelled) setJob(next);
          })
          .catch((e) => {
            if (!cancelled) setError(e.message);
          }),
      700,
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);
  useEffect(() => {
    const chunk = job?.chunks[chunkIndex];
    const key = job ? `${job.id}:${chunkIndex}` : "";
    if (
      active &&
      !fullAudio.current &&
      chunk?.status === "ready" &&
      chunk.audioUrl &&
      loaded.current !== key &&
      audio.current
    ) {
      loaded.current = key;
      audio.current.src = mediaUrl(chunk.audioUrl);
      audio.current.playbackRate = speed;
      if (shouldPlay.current)
        audio.current
          .play()
          .catch(() => setError("Audio is ready. Press Play to listen."));
    }
  }, [job, chunkIndex, active]);
  useEffect(() => {
    if (audio.current) {
      audio.current.playbackRate = speed;
    }
  }, [speed, volume]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (audio.current)
        setTime(
          audio.current.currentTime +
            (job && !fullAudio.current ? chunkStart(job, chunkIndex) : 0),
        );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, job, chunkIndex]);
  useEffect(() => {
    let next: { start: number; end: number } | null = null;
    if (active && follow && job && snapshot.current) {
      const chunk = job.chunks
        .map((c, i) => ({ ...c, startSeconds: chunkStart(job, i) }))
        .find(
          (c) =>
            time >= c.startSeconds && time < c.startSeconds + (c.seconds || 0),
        );
      if (chunk) {
        const source = [...snapshot.current.chapters]
          .reverse()
          .find((c) => (chunk.sourceStart || 0) >= c.offset);
        const current = p.project.book?.chapters.find(
          (c) => c.id === source?.id,
        );
        if (
          source &&
          current &&
          current.text === source.text &&
          (current.id === p.chapter.id || playing)
        ) {
          const relative = time - (chunk.startSeconds || 0);
          const word = spokenWord(chunk.wordTimings, relative);
          if (word) {
            const base = (chunk.sourceStart || 0) - source.offset;
            next = {
              start:
                source.base +
                utf16(source.text.slice(source.base), base + word.sourceStart),
              end:
                source.base +
                utf16(source.text.slice(source.base), base + word.sourceEnd),
            };
          }
          if (current.id !== p.chapter.id) p.onChapter(current.id);
        }
      }
    }
    if (range?.start !== next?.start || range?.end !== next?.end) {
      setRange(next);
      p.onHighlight(next);
    }
  }, [time, job, follow, active, playing, p.chapter.id, p.chapter.text]);
  const read = async () => {
    try {
      setError("");
      setActive(false);
      audio.current?.pause();
      p.onHighlight(null);
      await p.flush();
      const span = p.editorRef.current?.getSelectionOffsets() || {
        start: 0,
        end: 0,
      };
      const list =
        scope === "book"
          ? p.project.book!.chapters.filter((c) => c.include)
          : [p.chapter];
      if (scope === "selection" && span.start === span.end)
        throw new Error("Select the words to read in the chapter.");
      let offset = 0;
      snapshot.current = {
        chapters: list.map((c) => {
          const base =
            scope === "selection" || scope === "cursor" ? span.start : 0;
          const row = { id: c.id, text: c.text, offset, base };
          offset += Array.from(c.text).length + 2;
          return row;
        }),
      };
      const text =
        scope === "selection"
          ? p.chapter.text.slice(span.start, span.end)
          : scope === "cursor"
            ? p.chapter.text.slice(span.start)
            : undefined;
      const next = await api<Job>(
        `/api/projects/${p.project.id}/speech`,
        "POST",
        {
          scope: text === undefined ? scope : "selection",
          chapterId: p.chapter.id,
          text,
          voiceId: voice,
          follow: true,
          sapiRate: rate,
          sapiPitch: pitch,
          sapiVolume: 100,
          ...(p.project.settings.speechOptions || {}),
          format,
          verify: false,
        },
      );
      setJob(next);
      setTime(0);
      setChunkIndex(0);
      fullAudio.current = false;
      loaded.current = "";
      shouldPlay.current = true;
      setActive(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const stop = () => {
    setActive(false);
    shouldPlay.current = false;
    audio.current?.pause();
    if (audio.current) audio.current.currentTime = 0;
    setTime(0);
    p.onHighlight(null);
    if (job && !["ready", "failed", "cancelled"].includes(job.status))
      api<Job>(`/api/speech/jobs/${job.id}/cancel`, "POST")
        .then(setJob)
        .catch((e) => setError(e.message));
  };
  const bookmarks = (p.project.settings.readingBookmarks || []) as {
    chapterId: string;
    offset: number;
    context: string;
    name: string;
  }[];
  useEffect(() => {
    const execute = (command: string) => {
      if (command === "reading-stop" || command === "stop") stop();
      if (command === "reading-toggle" || command === "toggle") {
        if (playing) {
          shouldPlay.current = false;
          audio.current?.pause();
        } else if (playable) {
          shouldPlay.current = true;
          setActive(true);
          void audio.current?.play().catch((e) => setError(e.message));
        } else void read();
      }
      if (command === "reading-read") void read();
    };
    const local = (event: Event) =>
      execute((event as CustomEvent<string>).detail);
    window.addEventListener("alder-reading-command", local);
    const off = window.alder?.onCommand(execute);
    return () => {
      off?.();
      window.removeEventListener("alder-reading-command", local);
    };
  });
  return (
    <section className="document-reader" aria-label="Document reader">
      <div className="reader-controls">
        <select
          aria-label="Reading voice"
          value={voice}
          onChange={(e) => {
            const id = e.target.value;
            setVoice(id);
            p.change((project) => {
              const c = project.book!.chapters.find(
                (c) => c.id === p.chapter.id,
              );
              if (c) c.voiceId = id;
            });
          }}
        >
          <optgroup label="Chatterbox · local">
            {voices
              .filter((v) => v.kind !== "sapi")
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Windows SAPI">
            {voices
              .filter((v) => v.kind === "sapi")
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </optgroup>
        </select>
        <select
          aria-label="Reading scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="chapter">Chapter</option>
          <option value="book">Whole book</option>
          <option value="selection">Selection</option>
          <option value="cursor">From cursor</option>
        </select>
        <select
          aria-label="Reading audio format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        >
          <option value="wav">WAV</option>
          <option value="mp3">MP3</option>
          <option value="flac">FLAC</option>
        </select>
        <button
          onClick={() => void read()}
          disabled={
            !!job &&
            !["ready", "failed", "cancelled", "interrupted"].includes(
              job.status,
            )
          }
        >
          <Play size={12} />
          Read
        </button>
        <button
          aria-label={playing ? "Pause reading" : "Resume reading"}
          disabled={!playable}
          onClick={() => {
            if (playing) {
              shouldPlay.current = false;
              audio.current?.pause();
            } else {
              shouldPlay.current = true;
              setActive(true);
              void audio.current?.play().catch((e) => setError(e.message));
            }
          }}
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button aria-label="Stop reading" onClick={stop}>
          <Square size={12} />
        </button>
        <span className="speed-control">
          Speed <PlaybackSpeed value={speed} onChange={setSpeed} />×
        </span>
        <label>
          Volume{" "}
          <input
            aria-label="Reading volume"
            title={`Narration volume: ${Math.round(volume * 100)}%`}
            type="range"
            min="0"
            max="4"
            step=".01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
        {voice.startsWith("sapi-") && (
          <label>
            Voice rate{" "}
            <input
              aria-label="SAPI voice rate"
              type="number"
              min="-10"
              max="10"
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            />
          </label>
        )}
        {voice.startsWith("sapi-") && (
          <label>
            Pitch{" "}
            <input
              aria-label="SAPI pitch"
              type="number"
              min="-10"
              max="10"
              value={pitch}
              onChange={(e) => setPitch(Number(e.target.value))}
            />
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Follow text
        </label>
        <button
          aria-label="Bookmark reading position"
          onClick={() => {
            const offset =
              range?.start ||
              p.editorRef.current?.getSelectionOffsets().start ||
              0;
            p.change((project) => {
              project.settings.readingBookmarks = [
                ...bookmarks,
                {
                  chapterId: p.chapter.id,
                  offset,
                  context: p.chapter.text.slice(offset, offset + 60),
                  name: `${p.chapter.title} · ${offset + 1}`,
                },
              ];
            });
          }}
        >
          <BookmarkPlus size={13} />
        </button>
        {job?.audioUrl && (
          <button
            aria-label="Save reading audio"
            onClick={() =>
              void download(
                job.audioUrl!,
                `${p.project.name}.${job.format || "wav"}`,
              )
            }
          >
            <Download size={13} />
          </button>
        )}
        {job?.status === "ready" && (
          <select
            aria-label="Export timed text"
            value=""
            onChange={(e) => {
              void download(
                `/api/speech/jobs/${job.id}/subtitles?format=${e.target.value}`,
                `${p.project.name}.${e.target.value}`,
              ).catch((e) => setError(e.message));
            }}
          >
            <option value="">Timed text…</option>
            <option value="srt">SRT subtitles</option>
            <option value="lrc">LRC lyrics</option>
          </select>
        )}
        {job && ["cancelled", "failed", "interrupted"].includes(job.status) && (
          <button
            onClick={() =>
              api<Job>(`/api/speech/jobs/${job.id}/resume`, "POST")
                .then((j) => {
                  setJob(j);
                  setActive(true);
                })
                .catch((e) => setError(e.message))
            }
          >
            Resume rendering
          </button>
        )}
      </div>
      <div className="reader-progress">
        <span>
          {job?.status === "ready"
            ? duration(time)
            : job?.message ||
              "Read your document with Chatterbox or an installed Windows voice."}
        </span>
        {job?.status === "ready" && (
          <input
            aria-label="Reading position"
            type="range"
            min="0"
            max={job.seconds || 0}
            step=".05"
            value={time}
            onChange={(e) => {
              if (audio.current && job.audioUrl) {
                const element = audio.current,
                  position = Number(e.target.value),
                  resume = playing;
                if (!fullAudio.current) {
                  fullAudio.current = true;
                  element.onloadedmetadata = () => {
                    element.currentTime = position;
                    if (resume) void element.play();
                    element.onloadedmetadata = null;
                  };
                  element.src = mediaUrl(job.audioUrl);
                } else element.currentTime = position;
                setActive(true);
                setTime(position);
              }
            }}
          />
        )}
        <span>{job?.seconds ? duration(job.seconds) : ""}</span>
        {bookmarks.length > 0 && (
          <select
            aria-label="Reading bookmarks"
            value=""
            onChange={(e) => {
              const b = bookmarks[Number(e.target.value)],
                c = p.project.book!.chapters.find((c) => c.id === b.chapterId);
              if (!c || c.text.slice(b.offset, b.offset + 60) !== b.context) {
                setError(
                  "This bookmark's wording has changed. Create a new bookmark at the desired position.",
                );
                return;
              }
              p.onChapter(c.id);
              setTimeout(
                () => p.editorRef.current?.selectRange(b.offset, b.offset),
                50,
              );
              setScope("cursor");
            }}
          >
            <option value="">Bookmarks</option>
            {bookmarks.map((b, i) => (
              <option key={i} value={i}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {(error || job?.error) && <p role="alert">{error || job?.error}</p>}
      {job?.status === "ready" && job.chunks.some((c) => c.timingError) && (
        <p>
          Word timing is unavailable for some passages. Highlighting pauses
          there and resumes when word timing is available.
        </p>
      )}
      {snapshot.current &&
        !snapshot.current.chapters.every(
          (s) =>
            p.project.book?.chapters.find((c) => c.id === s.id)?.text ===
            s.text,
        ) && (
          <p>
            The text changed after rendering. Read again to update the audio and
            highlighting.
          </p>
        )}
      <audio
        crossOrigin="anonymous"
        ref={audio}
        onTimeUpdate={(e) =>
          setTime(
            e.currentTarget.currentTime +
              (job && !fullAudio.current ? chunkStart(job, chunkIndex) : 0),
          )
        }
        onPlay={() => {
          resumeAudio();
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          p.onHighlight(null);
          if (job && !fullAudio.current && chunkIndex + 1 < job.chunks.length) {
            shouldPlay.current = true;
            setChunkIndex((i) => i + 1);
          } else setActive(false);
        }}
      />
    </section>
  );
}

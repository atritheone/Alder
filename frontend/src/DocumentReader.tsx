import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  BookmarkPlus,
  Download,
  LoaderCircle,
  Pause,
  Play,
  Square,
} from "lucide-react";
import { api, download, duration, mediaUrl } from "./api";
import type { Chapter, Job, Project, Voice } from "./types";
import type { EditorHandle } from "./Editor";

import { useNarrationGain } from "./audioPlayback";
import { spokenWord } from "./wordFollowing";
import { readingCursorOffset } from "./readingCursor";
import PlaybackSpeed from "./PlaybackSpeed";

type Props = {
  project: Project;
  chapter: Chapter;
  editorRef: RefObject<EditorHandle | null>;
  flush: () => Promise<void>;
  change: (fn: (p: Project) => void) => void;
  onChapter: (id: string) => void;
  onPlaybackChange: (playing: boolean) => void;
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
  const [speed, setSpeed] = useState(1),
    [volume, setVolume] = useState(2);
  const [rate, setRate] = useState(0),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const format = "wav";
  const [buffering, setBuffering] = useState(false);
  const [resumeAfterCancel, setResumeAfterCancel] = useState(false);
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
    const refresh = () =>
      api<{ voices: Voice[] }>("/api/speech/voices")
        .then((r) => {
          setVoices(r.voices);
          setVoice((current) =>
            r.voices.some((v) => v.id === current)
              ? current
              : r.voices[0]?.id || "default",
          );
        })
        .catch((e) => setError(e.message));
    void refresh();
    window.addEventListener("alder-voices-changed", refresh);
    return () => window.removeEventListener("alder-voices-changed", refresh);
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
    // Audio can keep playing while Chromium suspends animation frames for an
    // obscured window. Sample its clock independently of paint scheduling.
    const tick = () => {
      if (audio.current)
        setTime(
          audio.current.currentTime +
            (job && !fullAudio.current ? chunkStart(job, chunkIndex) : 0),
        );
    };
    tick();
    const timer = setInterval(tick, 25);
    return () => clearInterval(timer);
  }, [playing, job, chunkIndex]);
  useLayoutEffect(() => {
    let next: { start: number; end: number } | null = null;
    if (active && follow && job && snapshot.current) {
      const chunk = fullAudio.current
        ? job.chunks
            .map((c, i) => ({ ...c, startSeconds: chunkStart(job, i) }))
            .find(
              (c) =>
                time >= c.startSeconds &&
                time < c.startSeconds + (c.seconds || 0),
            )
        : job.chunks[chunkIndex];
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
          const relative = fullAudio.current
            ? time - (chunk.startSeconds || 0)
            : audio.current?.currentTime || 0;
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
  }, [
    time,
    job,
    follow,
    active,
    playing,
    p.chapter.id,
    p.chapter.text,
    chunkIndex,
  ]);
  const requestInFlight = useRef(false);
  const playbackRequest = useRef(0);
  const [requesting, setRequesting] = useState(false);
  const lastConfiguration = useRef("");
  const currentConfiguration = (
    cursor = p.editorRef.current?.getSelectionOffsets().start,
  ) =>
    JSON.stringify([
      voice,
      rate,
      pitch,
      format,
      p.project.settings.speechOptions,
      p.chapter.id,
      p.chapter.text,
      cursor,
    ]);
  const pendingCaret = useRef<{
    id: string;
    text: string;
    offset: number;
  } | null>(null);
  useEffect(() => {
    const pending = pendingCaret.current;
    if (
      pending &&
      pending.id === p.chapter.id &&
      pending.text === p.chapter.text
    ) {
      // A chapter switch recreates the editor in its effect. Place the caret
      // after that view is ready rather than selecting in the old chapter.
      const timer = setTimeout(() => {
        pendingCaret.current = null;
        p.editorRef.current?.selectRange(pending.offset, pending.offset);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [p.chapter.id, p.chapter.text]);
  const parkCursor = (finished = false) => {
    if (!active && !lastConfiguration.current) return;
    const source = snapshot.current?.chapters[0];
    const current = p.project.book?.chapters.find((c) => c.id === source?.id);
    if (!job || !source || !current || current.text !== source.text) return;
    let offset = source.base;
    if (finished) offset = source.text.length;
    else {
      const elapsed = audio.current?.currentTime || 0;
      const index = fullAudio.current
        ? Math.max(
            0,
            job.chunks.reduce(
              (found, _, i) => (chunkStart(job, i) <= elapsed ? i : found),
              0,
            ),
          )
        : chunkIndex;
      const chunk = job.chunks[index];
      if (!chunk) return;
      const relative = fullAudio.current
        ? elapsed - chunkStart(job, index)
        : loaded.current === `${job.id}:${index}`
          ? elapsed
          : 0;
      offset += utf16(
        source.text.slice(source.base),
        readingCursorOffset(chunk, relative),
      );
    }
    if (source.id === p.chapter.id) {
      p.editorRef.current?.selectRange(offset, offset);
      // Our own caret movement must not be mistaken for the user choosing a
      // new reading position. Preserve paused audio and its exact time.
      if (finished) lastConfiguration.current = "";
      else if (lastConfiguration.current) {
        const saved = JSON.parse(lastConfiguration.current);
        saved[saved.length - 1] = offset;
        lastConfiguration.current = JSON.stringify(saved);
      }
    } else {
      pendingCaret.current = { id: source.id, text: source.text, offset };
      lastConfiguration.current = "";
      p.onChapter(source.id);
    }
  };
  const rendering =
    !!job &&
    !["ready", "failed", "cancelled", "interrupted"].includes(job.status);

  const read = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const request = ++playbackRequest.current;
    const requestedConfiguration = currentConfiguration();
    setRequesting(true);
    try {
      setError("");
      setActive(false);
      audio.current?.pause();
      p.onHighlight(null);
      const span = p.editorRef.current?.getSelectionOffsets() || {
        start: 0,
        end: 0,
      };
      await p.flush();
      const text = p.chapter.text.slice(span.start);
      if (!text.trim()) return;
      snapshot.current = {
        chapters: [
          {
            id: p.chapter.id,
            text: p.chapter.text,
            offset: 0,
            base: span.start,
          },
        ],
      };
      if (rendering && job)
        await api(`/api/speech/jobs/${job.id}/cancel`, "POST");
      const next = await api<Job>(
        `/api/projects/${p.project.id}/speech`,
        "POST",
        {
          scope: "selection",
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
      if (request !== playbackRequest.current) {
        await api(`/api/speech/jobs/${next.id}/cancel`, "POST");
        return;
      }
      lastConfiguration.current = requestedConfiguration;
      setJob(next);
      setTime(0);
      setChunkIndex(0);
      fullAudio.current = false;
      loaded.current = "";
      shouldPlay.current = true;
      setActive(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      requestInFlight.current = false;
      setRequesting(false);
    }
  };
  const resumeReading = async () => {
    if (!job || requestInFlight.current) return;
    requestInFlight.current = true;
    setRequesting(true);
    setError("");
    shouldPlay.current = true;
    setActive(true);
    try {
      const next = await api<Job>(`/api/speech/jobs/${job.id}/resume`, "POST");
      setJob(next);
      if (!shouldPlay.current) return;
      // Resume the retained audio at its paused position, including after Stop.
      if (
        next.chunks[chunkIndex]?.status === "ready" &&
        loaded.current === `${job.id}:${chunkIndex}` &&
        audio.current?.src &&
        !audio.current.ended
      ) {
        await audio.current.play();
      }
    } catch (e) {
      shouldPlay.current = false;
      setActive(false);
      setError((e as Error).message);
    } finally {
      requestInFlight.current = false;
      setRequesting(false);
    }
  };
  useEffect(() => {
    if (
      resumeAfterCancel &&
      job &&
      ["cancelled", "failed", "interrupted"].includes(job.status)
    ) {
      setResumeAfterCancel(false);
      void resumeReading();
    }
  }, [resumeAfterCancel, job?.status]);
  const loading =
    requesting ||
    resumeAfterCancel ||
    buffering ||
    (active &&
      shouldPlay.current &&
      rendering &&
      !playing &&
      job?.chunks[chunkIndex]?.status !== "ready");
  useLayoutEffect(() => {
    p.onPlaybackChange(
      playing || (active && shouldPlay.current && (rendering || buffering)),
    );
  }, [playing, active, rendering, buffering]);
  useEffect(() => () => p.onPlaybackChange(false), [p.onPlaybackChange]);
  const togglePlayback = () => {
    if (playing) {
      shouldPlay.current = false;
      audio.current?.pause();
      parkCursor();
    } else if (
      job &&
      lastConfiguration.current === currentConfiguration() &&
      ["cancelled", "failed", "interrupted", "cancelling"].includes(job.status)
    ) {
      if (job.status === "cancelling") setResumeAfterCancel(true);
      else void resumeReading();
    } else if (
      playable &&
      lastConfiguration.current === currentConfiguration() &&
      job &&
      !["failed", "cancelled", "interrupted"].includes(job.status)
    ) {
      shouldPlay.current = true;
      setActive(true);
      if (
        audio.current &&
        !audio.current.ended &&
        (fullAudio.current || loaded.current === `${job.id}:${chunkIndex}`)
      )
        void audio.current.play().catch((e) => setError(e.message));
    } else if (
      !rendering ||
      lastConfiguration.current !== currentConfiguration()
    )
      void read();
  };
  const stop = () => {
    playbackRequest.current++;
    setResumeAfterCancel(false);
    setBuffering(false);
    setActive(false);
    shouldPlay.current = false;
    audio.current?.pause();
    if (!requesting) parkCursor();
    setRange(null);
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
      if (command === "reading-toggle" || command === "toggle")
        togglePlayback();
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
        <button
          aria-label={
            loading
              ? "Loading Reading"
              : playing
                ? "Pause Reading"
                : "Play Reading"
          }
          data-help="Read from the text cursor. Pause or Stop moves the cursor to the spoken position; Play continues from there. Move the cursor yourself to choose a new starting point."
          aria-busy={loading}
          disabled={loading}
          onMouseDown={(e) => e.preventDefault()}
          onClick={togglePlayback}
        >
          {loading ? (
            <LoaderCircle
              size={12}
              className="reading-spinner"
              aria-hidden="true"
            />
          ) : playing ? (
            <Pause size={12} />
          ) : (
            <Play size={12} />
          )}
        </button>
        <button aria-label="Stop reading" onClick={stop}>
          <Square size={12} />
        </button>
        <span className="speed-control">
          Speed <PlaybackSpeed value={speed} onChange={setSpeed} />
        </span>
        <label>
          Volume{" "}
          <input
            aria-label="Reading volume"
            data-help-label={`Narration volume: ${Math.round(volume * 100)}%`}
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
      </div>
      {(job?.status === "ready" || bookmarks.length > 0) && (
        <div className="reader-progress">
          {job?.status === "ready" && <span>{duration(time)}</span>}
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
                  c = p.project.book!.chapters.find(
                    (c) => c.id === b.chapterId,
                  );
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
      )}
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
            The text changed after rendering. Press Play to update the audio and
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
        onPlaying={() => setBuffering(false)}
        onWaiting={() => {
          if (shouldPlay.current && active) setBuffering(true);
        }}
        onPause={() => {
          setPlaying(false);
          setBuffering(false);
        }}
        onError={() => {
          setBuffering(false);
          setPlaying(false);
          setError("Audio could not be played. Press Play to retry.");
        }}
        onEnded={() => {
          setPlaying(false);
          p.onHighlight(null);
          if (job && !fullAudio.current && chunkIndex + 1 < job.chunks.length) {
            shouldPlay.current = true;
            setChunkIndex((i) => i + 1);
          } else {
            shouldPlay.current = false;
            parkCursor(true);
            setRange(null);
            setActive(false);
          }
        }}
      />
    </section>
  );
}

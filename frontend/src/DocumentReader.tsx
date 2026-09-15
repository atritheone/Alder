import {
  useSpeechJob,
  useSpeechDemand,
  codePointOffsets,
} from "./useSpeechJob";
import { useSpeechTransport } from "./useSpeechTransport";
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
import { useWheelSlider } from "./useWheelSlider";

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
  chapters: {
    id: string;
    text: string;
    offset: number;
    base: number;
    offsets: number[];
  }[];
};
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
  const volumeSlider = useWheelSlider(volume, setVolume, 0, 4, 0.05);
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
  const playable = !!job?.chunks.some((c) => c.playbackEligible);
  const [pitch, setPitch] = useState(0);
  const audio = useRef<HTMLAudioElement>(null),
    snapshot = useRef<Snapshot | null>(null),
    loaded = useRef("");
  const resumeAudio = useNarrationGain(audio, volume);
  const stopRef = useRef(() => {});
  const transport = useSpeechTransport(audio, () => stopRef.current());
  const playAudio = () => {
    transport.intent = shouldPlay.current;
    return transport.play().catch((error) => {
      shouldPlay.current = false;
      setBuffering(false);
      setPlaying(false);
      throw error;
    });
  };
  const nextAudio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const next = job?.chunks[chunkIndex + 1];
    if (!next?.playbackEligible || !next.audioUrl) return;
    const element = new Audio(mediaUrl(next.audioUrl));
    element.preload = "auto";
    element.crossOrigin = "anonymous";
    nextAudio.current = element;
    element.load();
    return () => {
      element.removeAttribute("src");
      element.load();
      nextAudio.current = null;
    };
  }, [
    job?.chunks[chunkIndex + 1]?.audioUrl,
    job?.chunks[chunkIndex + 1]?.playbackEligible,
    chunkIndex,
  ]);
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
  useSpeechJob(job, setJob);
  useSpeechDemand(
    job?.id,
    chunkIndex,
    speed,
    active ? (playing || shouldPlay.current ? "playing" : "paused") : "stopped",
  );
  useEffect(() => {
    const chunk = job?.chunks[chunkIndex];
    const key = job ? `${job.id}:${chunkIndex}` : "";
    if (
      job &&
      chunk &&
      !loaded.current &&
      shouldPlay.current &&
      !["ready", "needs_review", "failed", "cancelled", "interrupted"].includes(
        job.status,
      ) &&
      (chunk.processingSeconds || 0) > (chunk.seconds || 1) / speed
    ) {
      const ready = [];
      for (const next of job.chunks.slice(chunkIndex)) {
        if (!next.playbackEligible) break;
        ready.push(next);
      }
      // Slow hardware and fast listening need a small initial buffer. Bounds
      // remain below the scheduler's eight-section limit; never wait past an
      // unresolved passage, and leave retained/decoded resume immediate.
      if (
        ready.length < Math.min(3, job.chunks.length - chunkIndex) &&
        ready.reduce((seconds, c) => seconds + (c.seconds || 0), 0) < 4 * speed
      )
        return;
    }

    if (
      active &&
      !fullAudio.current &&
      chunk?.playbackEligible &&
      chunk.audioUrl &&
      loaded.current !== key &&
      audio.current
    ) {
      loaded.current = key;
      audio.current.src = mediaUrl(chunk.audioUrl);
      audio.current.playbackRate = speed;
      if (shouldPlay.current)
        playAudio().catch(() =>
          setError("Audio is ready. Press Play to listen."),
        );
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
                source.base + (source.offsets[base + word.sourceStart] ?? 0),
              end: source.base + (source.offsets[base + word.sourceEnd] ?? 0),
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
      offset +=
        source.offsets[
          Math.min(
            source.offsets.length - 1,
            Math.max(0, readingCursorOffset(chunk, relative)),
          )
        ] || 0;
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
    !["ready", "failed", "cancelled", "interrupted", "needs_review"].includes(
      job.status,
    );

  const read = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const request = ++playbackRequest.current;
    transport.prepare();
    shouldPlay.current = true;
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
      const sourceText = p.editorRef.current?.getText() ?? p.chapter.text;
      const text = sourceText.slice(span.start);
      if (!text.trim()) return;
      snapshot.current = {
        chapters: [
          {
            id: p.chapter.id,
            text: sourceText,
            offset: 0,
            base: span.start,
            offsets: codePointOffsets(text),
          },
        ],
      };
      await p.flush();
      if (request !== playbackRequest.current) return;
      if (rendering && job)
        void api(`/api/speech/jobs/${job.id}/cancel`, "POST");
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
          verify: true,
          interactive: true,
        },
      );
      if (request !== playbackRequest.current) {
        await api(`/api/speech/jobs/${next.id}/cancel`, "POST");
        return;
      }
      if (
        ["cancelled", "cancelling", "interrupted"].includes(next.status) ||
        (next.status === "failed" && !next.chunks[0]?.playbackEligible)
      ) {
        shouldPlay.current = false;
        transport.pause();
      }
      lastConfiguration.current = requestedConfiguration;
      setJob(next);
      setTime(0);
      setChunkIndex(0);
      fullAudio.current = false;
      loaded.current = "";
      setActive(true);
    } catch (e) {
      if (request === playbackRequest.current) setError((e as Error).message);
    } finally {
      if (request === playbackRequest.current) {
        requestInFlight.current = false;
        setRequesting(false);
      }
    }
  };
  const resumeReading = async () => {
    if (!job || requestInFlight.current) return;
    const request = playbackRequest.current;
    shouldPlay.current = true;
    transport.intent = true;
    transport.claim();
    setActive(true);
    setError("");
    // Retained audio resumes before the backend acknowledges new render demand.
    if (
      job.chunks[chunkIndex]?.playbackEligible &&
      loaded.current === `${job.id}:${chunkIndex}` &&
      audio.current?.src &&
      !audio.current.ended
    )
      void playAudio().catch((e) => setError(e.message));
    requestInFlight.current = true;
    setRequesting(true);
    try {
      const next = await api<Job>(`/api/speech/jobs/${job.id}/resume`, "POST");
      if (request !== playbackRequest.current) {
        if (!shouldPlay.current)
          void api(`/api/speech/jobs/${next.id}/cancel`, "POST").catch(
            () => {},
          );
        return;
      }
      setJob((previous) =>
        previous?.id === next.id &&
        (previous.eventSequence || 0) > (next.eventSequence || 0)
          ? previous
          : next,
      );
      if (next.status === "cancelling") setResumeAfterCancel(true);
      if (
        audio.current?.ended &&
        loaded.current === `${job.id}:${chunkIndex}` &&
        chunkIndex + 1 < next.chunks.length
      )
        setChunkIndex((i) => i + 1);
    } catch (e) {
      if (request === playbackRequest.current) setError((e as Error).message);
    } finally {
      if (request === playbackRequest.current) {
        requestInFlight.current = false;
        setRequesting(false);
      }
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
    (requesting && shouldPlay.current && !playing) ||
    (resumeAfterCancel && !playing) ||
    buffering ||
    (active &&
      shouldPlay.current &&
      rendering &&
      !playing &&
      (!job?.chunks[chunkIndex]?.playbackEligible || !loaded.current));
  useLayoutEffect(() => {
    p.onPlaybackChange(playing || (active && shouldPlay.current));
  }, [playing, active, rendering, buffering]);
  useEffect(() => () => p.onPlaybackChange(false), [p.onPlaybackChange]);
  const togglePlayback = () => {
    if (playing || (loading && shouldPlay.current)) {
      shouldPlay.current = false;
      transport.pause();
      setActive(true);
      setBuffering(false);
      parkCursor();
    } else if (
      requesting ||
      (job && rendering && lastConfiguration.current === currentConfiguration())
    ) {
      shouldPlay.current = true;
      transport.intent = true;
      setActive(true);
      setBuffering(true);
      if (audio.current?.src && loaded.current === `${job?.id}:${chunkIndex}`)
        void playAudio().catch((e) => setError(e.message));
    } else if (
      job &&
      lastConfiguration.current === currentConfiguration() &&
      [
        "cancelled",
        "failed",
        "interrupted",
        "cancelling",
        "needs_review",
      ].includes(job.status)
    ) {
      void resumeReading();
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
        void playAudio().catch((e) => setError(e.message));
      else if (audio.current?.ended && chunkIndex + 1 < job.chunks.length)
        setChunkIndex((i) => i + 1);
    } else if (
      !rendering ||
      lastConfiguration.current !== currentConfiguration()
    )
      void read();
  };
  const stop = (park = true) => {
    playbackRequest.current++;
    requestInFlight.current = false;
    setRequesting(false);
    transport.stop();
    setResumeAfterCancel(false);
    setBuffering(false);
    setActive(false);
    shouldPlay.current = false;
    audio.current?.pause();
    if (park && !requesting) parkCursor();
    setRange(null);
    p.onHighlight(null);
    if (job && !["ready", "failed", "cancelled"].includes(job.status))
      api<Job>(`/api/speech/jobs/${job.id}/cancel`, "POST")
        .then((next) =>
          setJob((previous) =>
            previous?.id === next.id &&
            (previous.eventSequence || 0) <= (next.eventSequence || 0)
              ? next
              : previous,
          ),
        )
        .catch((e) => setError(e.message));
  };
  stopRef.current = stop;
  useEffect(() => {
    if (
      snapshot.current &&
      !snapshot.current.chapters.some(
        (c) => c.id === p.chapter.id && c.text === p.chapter.text,
      )
    ) {
      stop(false);
      snapshot.current = null;
      lastConfiguration.current = "";
    }
  }, [p.chapter.id, p.chapter.text]);
  useEffect(() => {
    const chunk = job?.chunks[chunkIndex];
    if (
      active &&
      !requesting &&
      !chunk?.playbackEligible &&
      ["needs_review", "failed"].includes(job?.status || "")
    ) {
      shouldPlay.current = false;
      transport.pause();
      setBuffering(false);
      parkCursor();
      setRange(null);
      p.onHighlight(null);
      setActive(false);
      setError("Could not read this passage. Press Play to retry.");
    }
  }, [job, chunkIndex, active, requesting]);
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
          onFocus={() =>
            void api("/api/speech/prepare", "POST", { voiceId: voice }).catch(
              () => {},
            )
          }
          value={voice}
          onChange={(e) => {
            const id = e.target.value;
            stop();
            setVoice(id);
            void api("/api/speech/prepare", "POST", { voiceId: id }).catch(
              () => {},
            );
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
          disabled={false}
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
        <button aria-label="Stop reading" onClick={() => stop()}>
          <Square size={12} />
        </button>
        <span className="speed-control">
          Speed <PlaybackSpeed value={speed} onChange={setSpeed} />
        </span>
        <label>
          Volume{" "}
          <input
            aria-label="Reading volume"
            ref={volumeSlider}
            data-help-label={`Narration volume: ${Math.round(volume * 100)}%. Drag or scroll over the slider to adjust.`}
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
      {error && <p role="alert">{error}</p>}
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
        onPlay={(event) => {
          if (event.currentTarget.paused || !transport.intent) return;
          transport.claim();
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
          shouldPlay.current = false;
          transport.pause();
          setActive(false);
          setBuffering(false);
          setPlaying(false);
          setError("Audio could not be played. Press Play to retry.");
        }}
        onEnded={() => {
          setPlaying(false);
          p.onHighlight(null);
          if (job && !fullAudio.current && chunkIndex + 1 < job.chunks.length) {
            if (shouldPlay.current) setBuffering(true);
            const endedIndex = chunkIndex;
            const epoch = playbackRequest.current;
            const delay = ((job.settings?.pauseSeconds ?? 0.18) * 1000) / speed;
            setTimeout(() => {
              if (epoch !== playbackRequest.current) return;
              setChunkIndex((i) => (i === endedIndex ? i + 1 : i));
            }, delay);
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

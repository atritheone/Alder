import { useSpeechJob } from "./useSpeechJob";
import { useSpeechTransport } from "./useSpeechTransport";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AudioLines, LoaderCircle, Play, Square } from "lucide-react";
import { api, mediaUrl } from "./api";
import { useNarrationGain } from "./audioPlayback";
import type { Job, Voice } from "./types";

type Props = {
  projectId: string;
  voices: Voice[];
  onAdd: () => void;
  onPlaybackChange: (playing: boolean) => void;
  onChange: (voices: Voice[], removedId?: string) => void;
};
export default function VoiceManager(p: Props) {
  const [all, setAll] = useState(p.voices);
  const [selectedId, setSelectedId] = useState(p.voices[0]?.id || "default");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const loaded = useRef("");
  const request = useRef(0);
  const resumeAudio = useNarrationGain(audio);
  const stopRef = useRef(() => {});
  const transport = useSpeechTransport(audio, () => stopRef.current());
  useLayoutEffect(
    () => p.onPlaybackChange(playing),
    [playing, p.onPlaybackChange],
  );
  useEffect(() => () => p.onPlaybackChange(false), [p.onPlaybackChange]);
  const visible = all.filter((v) => !v.removed);
  const selected = visible.find((v) => v.id === selectedId) || visible[0];
  useEffect(() => {
    let live = true;
    api<{ voices: Voice[] }>("/api/speech/voices")
      .then((r) => {
        if (live) setAll(r.voices);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [p.voices]);
  useEffect(
    () => setName(selected?.name || ""),
    [selected?.id, selected?.name],
  );
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const refresh = async (removedId?: string) => {
    const result = await api<{ voices: Voice[] }>("/api/speech/voices");
    setAll(result.voices);
    p.onChange(
      result.voices.filter((v) => !v.removed),
      removedId,
    );
    window.dispatchEvent(new Event("alder-voices-changed"));
  };
  const stopTest = () => {
    request.current++;
    transport.stop();
    audio.current?.pause();
    setTesting(false);
    setPlaying(false);
    if (
      job &&
      !["ready", "failed", "cancelled", "interrupted"].includes(job.status)
    )
      void api(`/api/speech/jobs/${job.id}/cancel`, "POST").catch((e) =>
        setError(e.message),
      );
  };
  const test = async () => {
    if (!selected || selected.removed) return;
    if (testing) {
      stopTest();
      return;
    }
    const attempt = ++request.current;
    transport.prepare();
    setError("");
    setTesting(true);
    setJob(null);
    loaded.current = "";
    try {
      const next = await api<Job>(
        `/api/projects/${p.projectId}/speech`,
        "POST",
        {
          scope: "selection",
          text: "This is how this voice sounds when reading in Alder.",
          voiceId: selected.id,
          format: "wav",
          verify: true,
        },
      );
      if (attempt !== request.current) {
        await api(`/api/speech/jobs/${next.id}/cancel`, "POST");
        return;
      }
      setJob(next);
    } catch (e) {
      if (attempt === request.current) {
        setError((e as Error).message);
        setTesting(false);
      }
    }
  };
  useSpeechJob(job, setJob);
  stopRef.current = stopTest;
  useEffect(() => {
    if (!testing || !job) return;
    if (
      ["failed", "cancelled", "interrupted", "needs_review"].includes(
        job.status,
      )
    ) {
      setTesting(false);
      setError(
        job.error || "Voice test could not finish. Press Test to try again.",
      );
      return;
    }
    const chunk = job.chunks[0];
    if (
      chunk?.audioUrl &&
      chunk.playbackEligible &&
      loaded.current !== job.id &&
      audio.current
    ) {
      loaded.current = job.id;
      audio.current.src = mediaUrl(chunk.audioUrl);
      void transport.play().catch((e) => {
        setError(e.message);
        setTesting(false);
      });
    }
  }, [job, testing]);
  const update = async (action: "rename" | "remove") => {
    if (!selected) return;
    setBusy(true);
    setError("");
    if (action === "remove") stopTest();
    try {
      await api(
        `/api/speech/voices/${encodeURIComponent(selected.id)}`,
        action === "remove" ? "DELETE" : "PUT",
        action === "rename" ? { name: name.trim() } : undefined,
      );
      await refresh(action === "remove" ? selected.id : undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="voice-manager" aria-label="Voice Library">
      <button
        className="accent"
        onClick={p.onAdd}
        data-help="Add a reference voice from a clean recording longer than five seconds, ideally about ten seconds. Recordings are processed locally."
      >
        Add Reference Voice…
      </button>
      <div className="voice-selector" aria-label="Available Voices">
        {visible.map((v) => (
          <button
            key={v.id}
            aria-label={`Select Voice ${v.name}`}
            aria-pressed={selected?.id === v.id}
            data-help={`Select ${v.name} to rename, test, or remove it from Alder.`}
            onClick={() => {
              if (v.id !== selected?.id) stopTest();
              setSelectedId(v.id);
              void api("/api/speech/prepare", "POST", { voiceId: v.id }).catch(
                () => {},
              );
            }}
          >
            <AudioLines size={15} />
            <span>{v.name}</span>
            <small>
              {v.removed
                ? "Removed"
                : v.kind === "sapi"
                  ? "Windows"
                  : v.kind === "builtin"
                    ? "Built-In"
                    : "Reference"}
            </small>
          </button>
        ))}
      </div>
      {selected && (
        <form
          className="voice-actions"
          onSubmit={(e) => {
            e.preventDefault();
            void update("rename");
          }}
        >
          <label>
            Voice Name
            <input
              aria-label="Voice Name"
              data-help="The name displayed for this voice in Alder. Edit it and choose Rename to save it."
              value={name}
              maxLength={100}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="voice-action-buttons">
            <button
              type="submit"
              disabled={busy || !name.trim() || name.trim() === selected.name}
            >
              Rename
            </button>
            <button
              type="button"
              disabled={selected.removed || busy}
              aria-label={testing ? "Stop Voice Test" : "Test Voice"}
              data-help="Listen to a short passage with the selected voice. Stop Test ends the preview."
              aria-busy={testing && !playing}
              onClick={() => void test()}
            >
              {testing ? (
                playing ? (
                  <Square size={12} />
                ) : (
                  <LoaderCircle size={12} className="reading-spinner" />
                )
              ) : (
                <Play size={12} />
              )}
              {testing ? "Stop Test" : "Test"}
            </button>
            <button
              type="button"
              disabled={busy || all.filter((v) => !v.removed).length <= 1}
              data-help="Remove this voice from Alder's library. Windows installations and saved narration are kept. At least one voice must remain available."
              onClick={() => void update("remove")}
            >
              Remove
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <audio
        ref={audio}
        crossOrigin="anonymous"
        onPlay={(event) => {
          if (event.currentTarget.paused || !transport.intent) return;
          resumeAudio();
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTesting(false);
        }}
        onError={() => {
          setPlaying(false);
          setTesting(false);
          setError("The voice test audio could not be played.");
        }}
      />
    </section>
  );
}

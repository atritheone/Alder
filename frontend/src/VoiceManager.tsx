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
  const [showRemoved, setShowRemoved] = useState(false);
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
  useLayoutEffect(
    () => p.onPlaybackChange(playing),
    [playing, p.onPlaybackChange],
  );
  useEffect(() => () => p.onPlaybackChange(false), [p.onPlaybackChange]);
  const visible = all.filter((v) => showRemoved || !v.removed);
  const selected = visible.find((v) => v.id === selectedId) || visible[0];
  useEffect(() => {
    let live = true;
    api<{ voices: Voice[] }>("/api/speech/voices?includeRemoved=true")
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
    const result = await api<{ voices: Voice[] }>(
      "/api/speech/voices?includeRemoved=true",
    );
    setAll(result.voices);
    p.onChange(
      result.voices.filter((v) => !v.removed),
      removedId,
    );
    window.dispatchEvent(new Event("alder-voices-changed"));
  };
  const stopTest = () => {
    request.current++;
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
          verify: false,
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
  useEffect(() => {
    if (
      !testing ||
      !job ||
      ["ready", "failed", "cancelled", "interrupted"].includes(job.status)
    )
      return;
    let live = true;
    const timer = setInterval(() => {
      void api<Job>(`/api/speech/jobs/${job.id}`)
        .then((next) => {
          if (live) setJob(next);
        })
        .catch((e) => {
          if (live) {
            setError(e.message);
            setTesting(false);
          }
        });
    }, 500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status, testing]);
  useEffect(() => {
    if (!testing || !job) return;
    if (["failed", "cancelled", "interrupted"].includes(job.status)) {
      setTesting(false);
      setError(
        job.error || "Voice test could not finish. Press Test to try again.",
      );
      return;
    }
    const chunk = job.chunks[0];
    if (
      chunk?.audioUrl &&
      chunk.status === "ready" &&
      loaded.current !== job.id &&
      audio.current
    ) {
      loaded.current = job.id;
      audio.current.src = mediaUrl(chunk.audioUrl);
      void audio.current.play().catch((e) => {
        setError(e.message);
        setTesting(false);
      });
    }
  }, [job, testing]);
  const update = async (action: "rename" | "remove" | "restore") => {
    if (!selected) return;
    setBusy(true);
    setError("");
    if (action === "remove") stopTest();
    try {
      await api(
        `/api/speech/voices/${encodeURIComponent(selected.id)}`,
        action === "remove" ? "DELETE" : "PUT",
        action === "rename"
          ? { name: name.trim() }
          : action === "restore"
            ? { removed: false }
            : undefined,
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
      <label
        className="removed-voices-toggle"
        data-help="Show voices removed from Alder. Select one and choose Restore to make it available again."
      >
        <input
          type="checkbox"
          checked={showRemoved}
          onChange={(e) => setShowRemoved(e.target.checked)}
        />
        Show Removed Voices
      </label>
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
            {selected.removed ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void update("restore")}
              >
                Restore
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || all.filter((v) => !v.removed).length <= 1}
                data-help="Remove this voice from Alder's library. It can be restored using Show Removed Voices. Windows installations and saved narration are kept. At least one voice must remain available."
                onClick={() => void update("remove")}
              >
                Remove
              </button>
            )}
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <audio
        ref={audio}
        crossOrigin="anonymous"
        onPlay={() => {
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

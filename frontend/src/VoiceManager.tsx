import { openContextMenu } from "./ContextMenu";
import { useSpeechJob } from "./useSpeechJob";
import { useSpeechTransport } from "./useSpeechTransport";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AudioLines,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Square,
  X,
} from "lucide-react";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useRef<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
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
  useEffect(() => {
    if (editingId) {
      nameInput.current?.focus();
      nameInput.current?.select();
    }
  }, [editingId]);
  const rename = (voice: Voice) => {
    if (busy) return;
    setSelectedId(voice.id);
    setName(voice.name);
    editing.current = voice.id;
    setEditingId(voice.id);
  };
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
    setTestingId(null);
    setPlaying(false);
    if (
      job &&
      !["ready", "failed", "cancelled", "interrupted"].includes(job.status)
    )
      void api(`/api/speech/jobs/${job.id}/cancel`, "POST").catch((e) =>
        setError(e.message),
      );
  };
  const test = async (voice: Voice) => {
    if (voice.removed) return;
    if (testing && testingId === voice.id) {
      stopTest();
      return;
    }
    if (testing) stopTest();
    setSelectedId(voice.id);
    setTestingId(voice.id);
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
          voiceId: voice.id,
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
  const update = async (voice: Voice, action: "rename" | "remove") => {
    if (busy) return;
    if (action === "rename") {
      if (editing.current !== voice.id) return;
      editing.current = null;
      setEditingId(null);
      if (!name.trim() || name.trim() === voice.name) return;
    }
    setBusy(true);
    setError("");
    if (action === "remove" && testingId === voice.id) stopTest();
    try {
      await api(
        `/api/speech/voices/${encodeURIComponent(voice.id)}`,
        action === "remove" ? "DELETE" : "PUT",
        action === "rename" ? { name: name.trim() } : undefined,
      );
      await refresh(action === "remove" ? voice.id : undefined);
    } catch (e) {
      setError((e as Error).message);
      if (action === "rename") {
        editing.current = voice.id;
        setEditingId(voice.id);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="voice-manager" aria-label="Voice Library">
      <header className="voice-library-heading">
        <h3>Voices</h3>
        <button
          className="library-add-button"
          aria-label="Add reference voice"
          onClick={p.onAdd}
          data-help="Add a reference voice from a clean recording longer than five seconds, ideally about ten seconds. Recordings are processed locally."
        >
          <Plus size={19} />
        </button>
      </header>
      <div className="voice-selector" aria-label="Available Voices">
        {[
          visible.filter((v) => v.kind !== "sapi"),
          visible.filter((v) => v.kind === "sapi"),
        ]
          .filter((group) => group.length > 0)
          .map((group) => (
            <div
              className="voice-group"
              key={group[0].kind === "sapi" ? "sapi" : "chatterbox"}
            >
              {group.map((v) => (
                <div
                  className={`voice-card${selectedId === v.id ? " selected" : ""}`}
                  key={v.id}
                  onContextMenu={(event) => {
                    if ((event.target as Element).closest("input, form"))
                      return;
                    openContextMenu(
                      event,
                      [
                        {
                          label: "Rename",
                          disabled: busy,
                          run: () => rename(v),
                        },
                        {
                          label:
                            testing && testingId === v.id
                              ? "Stop test"
                              : "Test",
                          disabled: busy,
                          run: () => void test(v),
                        },
                        {
                          label: "Remove",
                          disabled: busy || visible.length <= 1,
                          run: () => void update(v, "remove"),
                        },
                      ],
                      { label: `${v.name} voice actions` },
                    );
                  }}
                  onClick={(e) => {
                    if (!(e.target as Element).closest("button, input, form"))
                      setSelectedId(v.id);
                  }}
                >
                  <div className="voice-card-name">
                    <AudioLines size={17} aria-hidden="true" />
                    {editingId === v.id ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void update(v, "rename");
                        }}
                      >
                        <input
                          ref={nameInput}
                          aria-label="Voice name"
                          value={name}
                          maxLength={100}
                          required
                          onChange={(event) => setName(event.target.value)}
                          onBlur={(event) => {
                            if (
                              !(event.relatedTarget as Element | null)?.closest(
                                ".alder-context-menu",
                              )
                            )
                              void update(v, "rename");
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Escape") {
                              event.preventDefault();
                              editing.current = null;
                              setEditingId(null);
                            }
                          }}
                        />
                      </form>
                    ) : (
                      <button
                        className="voice-name-button"
                        aria-label={`Select voice ${v.name}`}
                        aria-pressed={selectedId === v.id}
                        data-help="Double-click to rename this voice."
                        onClick={() => setSelectedId(v.id)}
                        onDoubleClick={() => rename(v)}
                        onKeyDown={(event) => {
                          if (event.key === "F2") {
                            event.preventDefault();
                            rename(v);
                          }
                        }}
                      >
                        {v.name}
                      </button>
                    )}
                  </div>
                  <div className="voice-card-actions">
                    <button
                      aria-label={`Rename voice ${v.name}`}
                      data-help="Rename this voice. Press Enter to save or Escape to cancel."
                      disabled={busy}
                      onClick={() => rename(v)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      aria-label={`${testing && testingId === v.id ? "Stop testing" : "Test voice"} ${v.name}`}
                      data-help="Listen to a short passage with this voice. Click again to stop."
                      aria-busy={testing && testingId === v.id && !playing}
                      disabled={busy}
                      onPointerEnter={() => {
                        void api("/api/speech/prepare", "POST", {
                          voiceId: v.id,
                        }).catch(() => {});
                      }}
                      onClick={() => void test(v)}
                    >
                      {testing && testingId === v.id ? (
                        playing ? (
                          <Square size={14} />
                        ) : (
                          <LoaderCircle size={14} className="reading-spinner" />
                        )
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                    <button
                      aria-label={`Remove voice ${v.name}`}
                      data-help="Remove this voice from Alder. Saved narration and Windows voice installations are kept. At least one voice must remain."
                      disabled={busy || visible.length <= 1}
                      onClick={() => void update(v, "remove")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>
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

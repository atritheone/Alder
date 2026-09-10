import { useEffect, useRef, useState } from "react";
import { AudioLines, Clock3, LoaderCircle, Play } from "lucide-react";
import type {
  Job,
  SpeechCheck,
  SpeechChunk,
  SpeechManualReview,
  SpeechReviewRequest,
} from "./types";
import { duration, mediaUrl } from "./api";
import "./narration-review.css";

type Props = {
  job: Job;
  onPlayChunk: (url: string) => void;
  onSeek: (seconds: number) => void;
  currentTime?: number;
  onReview?: (request: SpeechReviewRequest) => Promise<void>;
};
type Peaks = { minimum: Float32Array; maximum: Float32Array; seconds: number };
const waveformCache = new Map<string, Peaks>();
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

function checkLabel(check?: SpeechCheck) {
  if (!check) return "Not checked";
  return (
    (
      {
        matched: "Recognised wording matches",
        needs_review: "Listening review needed",
        error: "Content check unavailable",
        pending: "Content check pending",
      } as Record<string, string>
    )[check.status] || check.status
  );
}

async function limitedAudio(url: string, signal: AbortSignal) {
  const response = await fetch(mediaUrl(url), { signal });
  if (!response.ok)
    throw new Error("The audio could not be opened for its waveform.");
  if (Number(response.headers.get("content-length") || 0) > MAX_AUDIO_BYTES) {
    await response.body?.cancel();
    throw new Error(
      "This audio exceeds the 100 MB waveform limit. Use a shorter narration or listen to its individual chunks.",
    );
  }
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_AUDIO_BYTES)
      throw new Error("This audio exceeds the 100 MB waveform limit.");
    return buffer;
  }
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new Error(
          "This audio exceeds the 100 MB waveform limit. Use a shorter narration or listen to its individual chunks.",
        );
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged.buffer;
}

function Waveform({
  url,
  currentTime = 0,
  onSeek,
}: {
  url: string;
  currentTime?: number;
  onSeek: (seconds: number) => void;
}) {
  const [peaks, setPeaks] = useState<Peaks | null>(
      () => waveformCache.get(url) || null,
    ),
    [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cached = waveformCache.get(url);
    if (cached) {
      setPeaks(cached);
      return;
    }
    const abort = new AbortController();
    let disposed = false;
    let context: AudioContext | undefined;
    setPeaks(null);
    setError("");
    void (async () => {
      try {
        const bytes = await limitedAudio(url, abort.signal);
        if (disposed) return;
        context = new AudioContext();
        const decoded = await context.decodeAudioData(bytes);
        if (disposed) return;
        const resolution = 1000,
          minimum = new Float32Array(resolution),
          maximum = new Float32Array(resolution);
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const values = decoded.getChannelData(channel);
          for (let pixel = 0; pixel < resolution; pixel++) {
            const start = Math.floor((pixel * values.length) / resolution),
              end = Math.max(
                start + 1,
                Math.floor(((pixel + 1) * values.length) / resolution),
              );
            let low = minimum[pixel],
              high = maximum[pixel];
            for (
              let frame = start;
              frame < Math.min(end, values.length);
              frame++
            ) {
              low = Math.min(low, values[frame]);
              high = Math.max(high, values[frame]);
            }
            minimum[pixel] = low;
            maximum[pixel] = high;
          }
        }
        const result = { minimum, maximum, seconds: decoded.duration };
        waveformCache.set(url, result);
        while (waveformCache.size > 12) {
          const oldest = waveformCache.keys().next().value;
          if (oldest) waveformCache.delete(oldest);
          else break;
        }
        if (!disposed) setPeaks(result);
      } catch (failure) {
        if (!disposed && !abort.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      } finally {
        if (context) await context.close().catch(() => {});
      }
    })();
    return () => {
      disposed = true;
      abort.abort();
      if (context) void context.close().catch(() => {});
    };
  }, [url]);
  useEffect(() => {
    const element = canvas.current,
      context = element?.getContext("2d");
    if (!element || !context || !peaks) return;
    const { width, height } = element,
      middle = height / 2;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#d0d5c9";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#a2aa98";
    context.lineWidth = 1;
    for (let division = 0; division <= 10; division++) {
      const x = Math.round((division * width) / 10) + 0.5;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    context.strokeStyle = "#414d39";
    context.lineWidth = 1;
    for (let index = 0; index < peaks.minimum.length; index++) {
      const x = (index * width) / peaks.minimum.length;
      context.beginPath();
      context.moveTo(x, middle + peaks.minimum[index] * (middle - 5));
      context.lineTo(x, middle + peaks.maximum[index] * (middle - 5));
      context.stroke();
    }
    context.strokeStyle = "#a87415";
    context.lineWidth = 2;
    const x = Math.min(
      width,
      Math.max(0, (currentTime / peaks.seconds) * width),
    );
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }, [peaks, currentTime]);
  if (error)
    return (
      <p className="narration-review-note" role="status">
        {error}
      </p>
    );
  if (!peaks)
    return (
      <p className="narration-waveform-loading" role="status">
        <LoaderCircle size={13} className="spin" />
        Reading waveform from the saved audio…
      </p>
    );
  return (
    <div className="narration-waveform">
      <canvas
        ref={canvas}
        width={1000}
        height={88}
        role="img"
        aria-label="Waveform of the saved narration"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          onSeek(
            Math.max(
              0,
              Math.min(1, (event.clientX - bounds.left) / bounds.width),
            ) * peaks.seconds,
          );
        }}
      />
      <label>
        <span>{duration(currentTime)}</span>
        <input
          aria-label="Seek within this narration"
          type="range"
          min={0}
          max={peaks.seconds}
          step={0.05}
          value={Math.min(peaks.seconds, Math.max(0, currentTime))}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <span>{duration(peaks.seconds)}</span>
      </label>
      <p>Measured audio waveform. Use the slider or click to seek.</p>
    </div>
  );
}

function Differences({ check }: { check: SpeechCheck }) {
  const differences = check.differences || [];
  return (
    <div className="narration-check-details">
      {typeof check.wordErrorRate === "number" && (
        <p className="narration-check-score">
          Word error rate: {(check.wordErrorRate * 100).toFixed(1)}%
          <span>
            {check.expectedWords ?? "—"} expected · {check.heardWords ?? "—"}{" "}
            recognised
          </span>
        </p>
      )}
      {check.error && <p className="narration-review-error">{check.error}</p>}
      {differences.length > 0 && (
        <table>
          <caption>Recognition differences to review</caption>
          <thead>
            <tr>
              <th>Difference</th>
              <th>Expected</th>
              <th>Recognised</th>
            </tr>
          </thead>
          <tbody>
            {differences.map((difference, index) => (
              <tr key={index}>
                <td>
                  {difference.type === "delete"
                    ? "Omission"
                    : difference.type === "insert"
                      ? "Addition"
                      : "Substitution"}
                </td>
                <td>{difference.expected || "—"}</td>
                <td>{difference.heard || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {check.status === "matched" && (
        <p className="narration-review-note">
          The recognised words match the spoken text. Listen to assess delivery
          and pronunciation.
        </p>
      )}
      {check.status === "needs_review" && (
        <p className="narration-review-note">
          A difference may come from the generated speech or the recogniser.
          Spelling, numbers and homophones need listening review; written text
          is unchanged.
        </p>
      )}
      {check.model && (
        <p className="narration-check-model">
          {check.model}
          {check.checkedAt
            ? ` · ${new Date(check.checkedAt).toLocaleString()}`
            : ""}
          {check.modelRevision ? (
            <span title={check.modelRevision}>
              Model {check.modelRevision.slice(0, 12)}
            </span>
          ) : null}
        </p>
      )}
    </div>
  );
}

function ListeningDecision({
  label,
  chunkId,
  ready,
  review,
  accepted,
  onReview,
}: {
  label: string;
  chunkId?: string;
  ready: boolean;
  review?: SpeechManualReview;
  accepted: boolean;
  onReview: NonNullable<Props["onReview"]>;
}) {
  const [note, setNote] = useState(""),
    [listened, setListened] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const decide = async (value: boolean) => {
    setBusy(true);
    setError("");
    try {
      await onReview({ chunkId, accepted: value, note });
      setListened(false);
      setNote("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="narration-listening-decision">
      {accepted ? (
        <p className="narration-manually-accepted">
          Accepted after listening
          {review?.reviewedAt
            ? ` · ${new Date(review.reviewedAt).toLocaleString()}`
            : ""}
          . Recognition results are retained.
          {review?.note && <span>{review.note}</span>}
        </p>
      ) : (
        <p className="narration-review-note">
          Record your listening decision for {label}. It applies to this saved
          audio and source revision.
        </p>
      )}
      {review?.superseded && (
        <p className="narration-review-note">
          The earlier acceptance belongs to a different take and no longer
          applies.
        </p>
      )}
      <label className="narration-review-note-input">
        Review note
        <input
          aria-label={`Review note for ${label}`}
          type="text"
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional listening notes"
          disabled={busy}
        />
      </label>
      {!accepted && (
        <label className="narration-listened">
          <input
            type="checkbox"
            checked={listened}
            disabled={!ready || busy}
            onChange={(event) => setListened(event.target.checked)}
          />
          I listened to {label}
        </label>
      )}
      <button
        disabled={busy || (!accepted && (!ready || !listened))}
        onClick={() => void decide(!accepted)}
      >
        {busy
          ? "Saving review…"
          : accepted
            ? `Revoke acceptance of ${label}`
            : `Accept ${label} after listening`}
      </button>
      {error && (
        <p className="narration-review-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

function ChunkReview({
  chunk,
  index,
  assembled,
  onPlayChunk,
  onSeek,
  onReview,
}: {
  chunk: SpeechChunk;
  index: number;
  assembled: boolean;
  onPlayChunk: Props["onPlayChunk"];
  onSeek: Props["onSeek"];
  onReview: Props["onReview"];
}) {
  const attempts = chunk.qaAttempts || [],
    selected = chunk.selectedAttempt ?? 0;
  return (
    <details
      className={
        "narration-chunk-review qa-" + (chunk.qa?.status || "unchecked")
      }
    >
      <summary>
        <strong>Chunk {index + 1}</strong>
        <span>
          {typeof chunk.seconds === "number"
            ? `${chunk.seconds.toFixed(2)} s`
            : chunk.status}
        </span>
        <span className="narration-check-state">{checkLabel(chunk.qa)}</span>
      </summary>
      <div className="narration-chunk-content">
        <div className="narration-chunk-actions">
          <button
            disabled={
              !chunk.audioUrl || !["ready", "completed"].includes(chunk.status)
            }
            aria-label={`Listen to chunk ${index + 1}`}
            onClick={() => chunk.audioUrl && onPlayChunk(chunk.audioUrl)}
          >
            <Play size={12} />
            Listen to chunk
          </button>
          {typeof chunk.startSeconds === "number" && (
            <button
              disabled={!assembled}
              aria-label={`Seek to chunk ${index + 1}`}
              onClick={() => onSeek(chunk.startSeconds!)}
            >
              <Clock3 size={12} />
              {duration(chunk.startSeconds)}
            </button>
          )}
          <span>
            {attempts.length
              ? `Take ${selected + 1} of ${attempts.length}`
              : "Original take"}
            {typeof (chunk.selectedSeed ?? chunk.seed) === "number"
              ? ` · seed ${chunk.selectedSeed ?? chunk.seed}`
              : ""}
          </span>
        </div>
        <dl className="narration-wording">
          <div>
            <dt>Written</dt>
            <dd>{chunk.text}</dd>
          </div>
          <div>
            <dt>Spoken</dt>
            <dd>{chunk.spokenText ?? chunk.text}</dd>
          </div>
          <div>
            <dt>Recognised</dt>
            <dd>{chunk.qa?.transcript || "No transcription available."}</dd>
          </div>
        </dl>
        {!!chunk.pronunciationMap?.length && (
          <p className="narration-review-note">
            Pronunciation substitutions:{" "}
            {chunk.pronunciationMap
              .map((mapping) => `${mapping.word} → ${mapping.spoken}`)
              .join("; ")}
          </p>
        )}
        {chunk.qa ? (
          <Differences check={chunk.qa} />
        ) : (
          <p className="narration-review-note">
            Automatic content checking was not performed. Listen before using
            this narration.
          </p>
        )}
        {onReview && (
          <ListeningDecision
            label={`chunk ${index + 1}`}
            chunkId={chunk.id}
            ready={chunk.status === "ready"}
            review={chunk.manualReview}
            accepted={
              !!chunk.manualReview?.accepted && !chunk.manualReview.superseded
            }
            onReview={onReview}
          />
        )}
        {attempts.length > 0 && (
          <details className="narration-attempts">
            <summary>Saved take checks ({attempts.length})</summary>
            {attempts.map((attempt) => (
              <article key={attempt.index}>
                <header>
                  <strong>
                    Take {attempt.index + 1}
                    {attempt.index === selected ? " · selected" : ""}
                  </strong>
                  <span>
                    Seed {attempt.seed}
                    {attempt.seconds
                      ? ` · ${attempt.seconds.toFixed(2)} s`
                      : ""}
                  </span>
                  {attempt.audioUrl && (
                    <button
                      aria-label={`Listen to chunk ${index + 1}, take ${attempt.index + 1}`}
                      onClick={() => onPlayChunk(attempt.audioUrl!)}
                    >
                      <Play size={10} />
                      Listen
                    </button>
                  )}
                </header>
                <p>{attempt.qa?.transcript || "No transcription available."}</p>
                {attempt.qa && <Differences check={attempt.qa} />}
              </article>
            ))}
          </details>
        )}
      </div>
    </details>
  );
}

export default function NarrationReview({
  job,
  onPlayChunk,
  onSeek,
  currentTime = 0,
  onReview,
}: Props) {
  const [open, setOpen] = useState(job.reviewStatus === "needs_review"),
    [showWaveform, setShowWaveform] = useState(false);
  useEffect(() => {
    if (job.reviewStatus === "needs_review") setOpen(true);
  }, [job.reviewStatus]);
  return (
    <details
      className="narration-review"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <AudioLines size={13} />
        <span>Review chunks and wording</span>
        <small>
          {job.chunks.length} chunks
          {job.verificationSummary
            ? ` · ${job.verificationSummary.needsReview} need review`
            : ""}
        </small>
      </summary>
      {open && (
        <div className="narration-review-body">
          <p className="narration-review-note">
            Content checks compare independent speech recognition with the
            narration wording. They do not establish natural delivery or exact
            word timing.
          </p>
          {job.audioUrl && (
            <>
              <button
                className="narration-waveform-toggle"
                aria-expanded={showWaveform}
                onClick={() => setShowWaveform((value) => !value)}
              >
                <AudioLines size={12} />
                {showWaveform ? "Hide waveform" : "Show waveform"}
              </button>
              {showWaveform && (
                <Waveform
                  url={job.audioUrl}
                  currentTime={currentTime}
                  onSeek={onSeek}
                />
              )}
            </>
          )}
          {onReview && (
            <ListeningDecision
              label="all chunks"
              ready={job.status === "ready"}
              accepted={job.manualReviewStatus === "accepted"}
              onReview={onReview}
            />
          )}
          {job.manualReviewSummary && (
            <p className="narration-review-note">
              Listening acceptance: {job.manualReviewSummary.accepted} of{" "}
              {job.manualReviewSummary.total} chunks. Automatic recognition:{" "}
              {job.reviewStatus?.replaceAll("_", " ") || "not checked"}.
            </p>
          )}
          {job.chunks.map((chunk, index) => (
            <ChunkReview
              key={chunk.id}
              chunk={chunk}
              index={index}
              assembled={!!job.audioUrl}
              onPlayChunk={onPlayChunk}
              onSeek={onSeek}
              onReview={onReview}
            />
          ))}
        </div>
      )}
    </details>
  );
}

import "./narration-review.css";

export type SpeechOptionsValue = {
  pauseSeconds: number;
  temperature: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  verificationRetries: number;
};
export const DEFAULT_SPEECH_OPTIONS: SpeechOptionsValue = {
  pauseSeconds: 0.18,
  temperature: 0.8,
  topP: 0.95,
  topK: 1000,
  repetitionPenalty: 1.2,
  verificationRetries: 1,
};
type Props = {
  options: SpeechOptionsValue;
  onChange: (options: SpeechOptionsValue) => void;
};

export default function SpeechOptions({ options, onChange }: Props) {
  const change = (key: keyof SpeechOptionsValue, value: number) => {
    if (Number.isFinite(value)) onChange({ ...options, [key]: value });
  };
  return (
    <details className="speech-options">
      <summary>Speech options</summary>
      <label>
        Boundary pause · seconds
        <input
          aria-label="Narration boundary pause"
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={options.pauseSeconds}
          onChange={(event) =>
            change("pauseSeconds", event.currentTarget.valueAsNumber)
          }
        />
      </label>
      <p>
        Silence inserted between completed chunks. Playback speed is controlled
        separately in the transport.
      </p>
      <label>
        Content-check retries
        <select
          aria-label="Content-check retries"
          value={options.verificationRetries}
          onChange={(event) =>
            change("verificationRetries", Number(event.target.value))
          }
        >
          <option value={0}>No retry · 1 take</option>
          <option value={1}>1 retry · up to 2 takes</option>
          <option value={2}>2 retries · up to 3 takes</option>
        </select>
      </label>
      <details>
        <summary>Turbo sampling</summary>
        <p>
          These sampling settings influence variation; they do not set an exact
          emotion, speaking rate or pronunciation.
        </p>
        <label>
          Temperature
          <input
            aria-label="Speech temperature"
            type="number"
            min={0.05}
            max={2}
            step={0.05}
            value={options.temperature}
            onChange={(event) =>
              change("temperature", event.currentTarget.valueAsNumber)
            }
          />
        </label>
        <label>
          Top P
          <input
            aria-label="Speech top P"
            type="number"
            min={0.01}
            max={1}
            step={0.01}
            value={options.topP}
            onChange={(event) =>
              change("topP", event.currentTarget.valueAsNumber)
            }
          />
        </label>
        <label>
          Top K
          <input
            aria-label="Speech top K"
            type="number"
            min={1}
            max={6563}
            step={1}
            value={options.topK}
            onChange={(event) =>
              change("topK", event.currentTarget.valueAsNumber)
            }
          />
        </label>
        <label>
          Repetition penalty
          <input
            aria-label="Speech repetition penalty"
            type="number"
            min={1}
            max={3}
            step={0.05}
            value={options.repetitionPenalty}
            onChange={(event) =>
              change("repetitionPenalty", event.currentTarget.valueAsNumber)
            }
          />
        </label>
      </details>
      <button onClick={() => onChange({ ...DEFAULT_SPEECH_OPTIONS })}>
        Restore speech defaults
      </button>
    </details>
  );
}

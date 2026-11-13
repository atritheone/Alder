import { useState } from "react";
import type { EditorView } from "@codemirror/view";
import { columnChanges } from "./plainTextColumns";

export default function TextColumnTools({
  getView,
  onMessage,
}: {
  getView: () => EditorView | null;
  onMessage: (message: string) => void;
}) {
  const [column, setColumn] = useState(1),
    [text, setText] = useState(""),
    [numbers, setNumbers] = useState(false),
    [start, setStart] = useState(1),
    [step, setStep] = useState(1),
    [padding, setPadding] = useState(0),
    [suffix, setSuffix] = useState("");
  return (
    <details className="txt-automation">
      <summary>Column editor</summary>
      <div className="txt-tools">
        <label>
          Column
          <input
            aria-label="Insert column"
            type="number"
            min={1}
            max={10001}
            value={column}
            onChange={(e) => setColumn(Number(e.target.value))}
          />
        </label>
        <label>
          Text / prefix
          <input
            aria-label="Column text or prefix"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={numbers}
            onChange={(e) => setNumbers(e.target.checked)}
          />
          Number lines
        </label>
        <label>
          Start
          <input
            aria-label="Column number start"
            type="number"
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
          />
        </label>
        <label>
          Step
          <input
            aria-label="Column number step"
            type="number"
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
          />
        </label>
        <label>
          Digits
          <input
            aria-label="Column number digits"
            type="number"
            min={0}
            max={20}
            value={padding}
            onChange={(e) => setPadding(Number(e.target.value))}
          />
        </label>
        <label>
          Suffix
          <input
            aria-label="Column suffix"
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
          />
        </label>
        <button
          onClick={() => {
            const v = getView();
            if (!v || v.state.readOnly) return;
            try {
              if (
                !Number.isSafeInteger(start) ||
                !Number.isSafeInteger(step) ||
                !Number.isInteger(padding) ||
                padding < 0 ||
                padding > 20
              )
                throw new Error("Use integer start/step and 0–20 digits.");
              const changes = columnChanges(
                v.state,
                column - 1,
                (index) =>
                  text +
                  (numbers
                    ? String(start + index * step).padStart(padding, "0")
                    : "") +
                  suffix,
              );
              v.dispatch({ changes, userEvent: "input.columns" });
              v.focus();
              onMessage(
                `Edited ${changes.length} selected line(s). Undo restores them together.`,
              );
            } catch (error) {
              onMessage((error as Error).message);
            }
          }}
        >
          Insert into selected lines
        </button>
        <small>
          Short lines are padded on insertion. Alt-drag selects a rectangle;
          Ctrl-click adds cursors.
        </small>
      </div>
    </details>
  );
}

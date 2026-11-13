import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  Transaction,
  type Transaction as TextTransaction,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { snippet } from "@codemirror/autocomplete";
import {
  prepareMacro,
  readMacros,
  recordMacroStep,
  type MacroStep,
  type TextMacro,
} from "./plainTextMacros";

type Snippet = { name: string; body: string };
function readSnippets(): Snippet[] {
  try {
    const value = JSON.parse(
      localStorage.getItem("alder.txt.snippets") || "[]",
    );
    return Array.isArray(value)
      ? value
          .filter(
            (v) => typeof v?.name === "string" && typeof v.body === "string",
          )
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
export default function TextAutomationTools({
  getView,
  recorder,
  onMessage,
}: {
  getView: () => EditorView | null;
  recorder: MutableRefObject<((tr: TextTransaction) => void) | null>;
  onMessage: (message: string) => void;
}) {
  const [macros, setMacros] = useState(readMacros),
    [recording, setRecording] = useState(false),
    [name, setName] = useState(""),
    [selected, setSelected] = useState(""),
    [repeat, setRepeat] = useState(1),
    [busy, setBusy] = useState(false);
  const recordingRef = useRef(false),
    steps = useRef<MacroStep[]>([]),
    abort = useRef<AbortController | null>(null);
  const [snippets, setSnippets] = useState(readSnippets),
    [snippetName, setSnippetName] = useState(""),
    [body, setBody] = useState("");
  useEffect(() => {
    recorder.current = (tr) => {
      if (
        !recordingRef.current ||
        tr.annotation(Transaction.addToHistory) === false
      )
        return;
      const step = recordMacroStep(tr);
      if (step) {
        if (steps.current.length >= 10000) {
          recordingRef.current = false;
          onMessage(
            "Recording reached 10,000 steps. Choose Stop and save recording to keep the recorded actions.",
          );
          return;
        }
        steps.current.push(step);
      }
    };
    return () => {
      recorder.current = null;
      abort.current?.abort();
    };
  }, [recorder, onMessage]);
  const saveMacros = (next: TextMacro[]) => {
    try {
      localStorage.setItem("alder.txt.macros", JSON.stringify(next));
      setMacros(next);
    } catch {
      onMessage(
        "The macro could not be saved. Local preference storage is full.",
      );
    }
  };
  const play = async () => {
    const v = getView(),
      macro = macros.find((m) => m.name === selected);
    if (!v || !macro || v.state.readOnly) return;
    const initial = v.state,
      controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      const result = await prepareMacro(
        initial,
        macro.steps,
        repeat,
        controller.signal,
      );
      if (v.state.doc !== initial.doc)
        throw new Error(
          "The document changed during macro preparation. Run it again.",
        );
      v.dispatch({ ...result, userEvent: "input.macro" });
      v.focus();
      onMessage("Macro applied as one undoable change.");
    } catch (error) {
      onMessage((error as Error).message);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };
  return (
    <details className="txt-automation">
      <summary>Macros &amp; snippets</summary>
      <div className="txt-tools">
        <input
          aria-label="Macro name"
          placeholder="Macro name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          disabled={busy}
          onClick={() => {
            if (!recording) {
              steps.current = [];
              recordingRef.current = true;
              setRecording(true);
              getView()?.focus();
            } else {
              recordingRef.current = false;
              setRecording(false);
              const title = name.trim() || `Macro ${macros.length + 1}`;
              if (steps.current.length) {
                saveMacros(
                  [
                    ...macros.filter((m) => m.name !== title),
                    { name: title, steps: [...steps.current] },
                  ].slice(-50),
                );
                setSelected(title);
              } else onMessage("No editing actions were recorded.");
            }
          }}
        >
          {recording ? "Stop and save recording" : "Record macro"}
        </button>
        <select
          aria-label="Saved macro"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose macro…</option>
          {macros.map((m) => (
            <option key={m.name}>{m.name}</option>
          ))}
        </select>
        <label>
          Repeat
          <input
            aria-label="Macro repetitions"
            type="number"
            min={1}
            max={1000}
            value={repeat}
            onChange={(e) => setRepeat(Number(e.target.value))}
          />
        </label>
        <button
          disabled={!selected || recording || busy}
          onClick={() => void play()}
        >
          Play macro
        </button>
        <button disabled={!busy} onClick={() => abort.current?.abort()}>
          Cancel macro
        </button>
        <button
          disabled={!selected || busy}
          onClick={() => {
            saveMacros(macros.filter((m) => m.name !== selected));
            setSelected("");
          }}
        >
          Delete macro
        </button>
      </div>
      <div className="txt-tools">
        <select
          aria-label="Saved snippet"
          value=""
          onChange={(e) => {
            const item = snippets.find((s) => s.name === e.target.value);
            if (item) {
              setSnippetName(item.name);
              setBody(item.body);
            }
          }}
        >
          <option value="" disabled>
            Choose snippet…
          </option>
          {snippets.map((s) => (
            <option key={s.name}>{s.name}</option>
          ))}
        </select>
        <input
          aria-label="Snippet name"
          placeholder="Snippet name"
          maxLength={100}
          value={snippetName}
          onChange={(e) => setSnippetName(e.target.value)}
        />
        <textarea
          aria-label="Snippet text"
          placeholder="Snippet text; use ${field} for editable placeholders"
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button
          disabled={!snippetName.trim() || !body}
          onClick={() => {
            const next = [
              ...snippets.filter((s) => s.name !== snippetName.trim()),
              { name: snippetName.trim(), body },
            ].slice(-100);
            try {
              localStorage.setItem("alder.txt.snippets", JSON.stringify(next));
              setSnippets(next);
              onMessage("Snippet saved.");
            } catch {
              onMessage("The snippet could not be saved.");
            }
          }}
        >
          Save snippet
        </button>
        <button
          disabled={!body}
          onClick={() => {
            const v = getView();
            if (v && !v.state.readOnly) {
              const r = v.state.selection.main;
              snippet(body)(v, null, r.from, r.to);
              v.focus();
            }
          }}
        >
          Insert snippet
        </button>
        <button
          disabled={!snippetName.trim()}
          onClick={() => {
            const next = snippets.filter((s) => s.name !== snippetName.trim());
            try {
              localStorage.setItem("alder.txt.snippets", JSON.stringify(next));
              setSnippets(next);
              setSnippetName("");
              setBody("");
            } catch {
              onMessage("The snippet could not be removed.");
            }
          }}
        >
          Delete snippet
        </button>
      </div>
    </details>
  );
}

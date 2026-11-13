import { useState } from "react";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { copyText } from "./clipboardText";
import { useStoredPreference } from "./useStoredPreference";

function readRing(): string[] {
  try {
    const raw = JSON.parse(
      localStorage.getItem("alder.txt.clipboardRing") || "[]",
    );
    return Array.isArray(raw)
      ? raw
          .filter((v) => typeof v === "string" && v.length <= 100000)
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
export function formattedDate(date: Date, format: string) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const parts: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => parts[token]);
}
export default function TextInsertionTools({
  getView,
  onMessage,
}: {
  getView: () => EditorView | null;
  onMessage: (message: string) => void;
}) {
  const [remember, setRemember] = useStoredPreference(
      "alder.txt.clipboardHistory",
      "false",
    ),
    [format, setFormat] = useStoredPreference(
      "alder.txt.dateFormat",
      "YYYY-MM-DD HH:mm:ss",
    );
  const [ring, setRing] = useState(readRing),
    [prefix, setPrefix] = useState("("),
    [suffix, setSuffix] = useState(")");
  const add = (text: string) => {
    if (remember !== "true" || text.length > 100000) return;
    const next = [text, ...ring.filter((v) => v !== text)].slice(0, 20);
    setRing(next);
    try {
      localStorage.setItem("alder.txt.clipboardRing", JSON.stringify(next));
    } catch {
      onMessage("Copied text, but clipboard history could not be remembered.");
    }
  };
  const insert = (text: string) => {
    const v = getView();
    if (!v || v.state.readOnly) return;
    v.dispatch(v.state.replaceSelection(text), {
      userEvent: "input.insert",
      scrollIntoView: true,
    });
    v.focus();
  };
  const copy = async (cut: boolean) => {
    const v = getView();
    if (!v || (cut && v.state.readOnly)) return;
    const state = v.state,
      ranges = state.selection.ranges
        .map((r) =>
          r.empty
            ? {
                from: state.doc.lineAt(r.head).from,
                to: Math.min(state.doc.length, state.doc.lineAt(r.head).to + 1),
                text: state.doc.lineAt(r.head).text + "\n",
              }
            : { from: r.from, to: r.to, text: state.sliceDoc(r.from, r.to) },
        )
        .filter((r, i, list) => i === 0 || r.from >= list[i - 1].to);
    const text = ranges
      .map((r) => r.text)
      .join(state.selection.ranges.some((r) => r.empty) ? "" : "\n");
    try {
      await copyText(text);
      add(text);
      if (cut) {
        if (v.state.doc !== state.doc)
          throw new Error(
            "Text changed during copying. Cut again to remove it.",
          );
        v.dispatch({
          changes: ranges.map((r) => ({ from: r.from, to: r.to })),
          userEvent: "input.cut",
        });
      }
      v.focus();
      onMessage(cut ? "Cut text. Undo restores it." : "Copied text.");
    } catch (error) {
      onMessage((error as Error).message);
    }
  };
  return (
    <details className="txt-automation">
      <summary>Clipboard &amp; insertion</summary>
      <div className="txt-tools">
        <button onClick={() => void copy(false)}>Copy selection or line</button>
        <button onClick={() => void copy(true)}>Cut selection or line</button>
        <button
          onClick={() => {
            const v = getView();
            if (!v || v.state.readOnly) return;
            const state = v.state;
            void (
              window.alder?.readClipboard
                ? window.alder.readClipboard()
                : navigator.clipboard.readText()
            )
              .then((text) => {
                if (
                  v.state.doc !== state.doc ||
                  !v.state.selection.eq(state.selection)
                )
                  throw new Error("The insertion point changed. Paste again.");
                insert(text);
              })
              .catch((error) => onMessage((error as Error).message));
          }}
        >
          Paste plain text
        </button>
        <label>
          <input
            type="checkbox"
            checked={remember === "true"}
            onChange={(e) => setRemember(String(e.target.checked))}
          />
          Remember copies made here
        </label>
        <select
          aria-label="Clipboard history"
          value=""
          onChange={(e) => insert(ring[Number(e.target.value)] || "")}
        >
          <option value="" disabled>
            Paste previous copy…
          </option>
          {ring.map((text, i) => (
            <option key={i} value={i}>
              {text.slice(0, 80).replace(/\n/g, " ↵ ")}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setRing([]);
            localStorage.removeItem("alder.txt.clipboardRing");
          }}
        >
          Clear clipboard history
        </button>
        <label>
          Date format
          <input
            aria-label="Date/time format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          />
        </label>
        <button onClick={() => insert(formattedDate(new Date(), format))}>
          Insert date/time
        </button>
        <label>
          Before
          <input
            aria-label="Surround selection before"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </label>
        <label>
          After
          <input
            aria-label="Surround selection after"
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
          />
        </label>
        <button
          onClick={() => {
            const v = getView();
            if (!v || v.state.readOnly) return;
            v.dispatch(
              v.state.changeByRange((r) => ({
                changes: {
                  from: r.from,
                  to: r.to,
                  insert: prefix + v.state.sliceDoc(r.from, r.to) + suffix,
                },
                range: EditorSelection.range(
                  r.from + prefix.length,
                  r.to + prefix.length,
                ),
              })),
              { userEvent: "input.surround", scrollIntoView: true },
            );
            v.focus();
          }}
        >
          Surround selections
        </button>
      </div>
    </details>
  );
}

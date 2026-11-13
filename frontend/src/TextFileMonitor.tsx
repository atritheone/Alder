import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { decodeTextBytes } from "./decodeTextBytes";
import { logLanguage, textHighlightStyle } from "./plainTextViews";

export default function TextFileMonitor({
  id,
  name,
  onClose,
}: {
  id: string;
  name: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    following = useRef(true);
  const [follow, setFollow] = useState(true),
    [status, setStatus] = useState("Reading file…");
  useEffect(() => {
    following.current = follow;
    const v = view.current;
    if (v && follow)
      v.dispatch({
        effects: EditorView.scrollIntoView(v.state.doc.length, { y: "end" }),
      });
  }, [follow]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lineNumbers(),
          logLanguage,
          textHighlightStyle,
          EditorView.contentAttributes.of({
            "aria-label": "Monitored TXT file",
          }),
          EditorView.domEventHandlers({
            scroll: (event) => {
              if (
                event.target === v.scrollDOM &&
                v.scrollDOM.scrollHeight -
                  v.scrollDOM.scrollTop -
                  v.scrollDOM.clientHeight >
                  24
              ) {
                following.current = false;
                setFollow(false);
              }
            },
          }),
        ],
      }),
    });
    view.current = v;
    dialog.current!.showModal();
    let cancelled = false,
      pending = false,
      digest = "";
    const poll = async () => {
      if (pending || cancelled) return;
      pending = true;
      try {
        const snapshot = await window.alder?.readDocumentFile?.(id);
        if (cancelled || !snapshot) return;
        if (snapshot.digest !== digest) {
          const text = decodeTextBytes(snapshot.bytes);
          digest = snapshot.digest;
          v.dispatch({
            changes: { from: 0, to: v.state.doc.length, insert: text },
          });
          if (following.current)
            v.dispatch({
              effects: EditorView.scrollIntoView(v.state.doc.length, {
                y: "end",
              }),
            });
          setStatus(
            `${snapshot.bytes.length.toLocaleString()} bytes · ${v.state.doc.lines.toLocaleString()} lines`,
          );
        }
      } catch (error) {
        if (!cancelled) setStatus((error as Error).message);
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      view.current = null;
      v.destroy();
      dialog.current?.close();
      previous?.focus();
    };
  }, [id]);
  return createPortal(
    <dialog
      ref={dialog}
      className="txt-compare-dialog"
      aria-label="Monitor TXT file"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <strong>Monitor {name}</strong>
        <label>
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Follow end
        </label>
        <button onClick={onClose}>Close monitor</button>
      </header>
      <p role="status">{status}</p>
      <div className="txt-monitor-host" ref={host} />
    </dialog>,
    document.body,
  );
}

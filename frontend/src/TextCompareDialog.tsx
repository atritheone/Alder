import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";

export default function TextCompareDialog({
  left,
  right,
  leftLabel,
  rightLabel,
  onClose,
}: {
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const extensions = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      lineNumbers(),
    ];
    const merge = new MergeView({
      a: { doc: left, extensions },
      b: { doc: right, extensions },
      parent: host.current!,
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 10 },
      diffConfig: { scanLimit: 1000 },
    });
    dialog.current!.showModal();
    return () => {
      merge.destroy();
      dialog.current?.close();
      previous?.focus();
    };
  }, [left, right]);
  return createPortal(
    <dialog
      className="txt-compare-dialog"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label="Compare text"
    >
      <header>
        <strong>Compare text</strong>
        <button onClick={onClose}>Close comparison</button>
      </header>
      <div className="txt-compare-labels">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div className="txt-compare-host" ref={host} />
    </dialog>,
    document.body,
  );
}

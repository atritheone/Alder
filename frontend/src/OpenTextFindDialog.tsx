import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FindPanel from "./FindPanel";
import type { Project } from "./types";
import type { BookSearchGroup } from "./bookFind";
import type { TextMatch } from "./findText";

export default function OpenTextFindDialog({
  documents,
  activeId,
  onSelect,
  onReplace,
  onReplaceAll,
  onError,
  onClose,
}: {
  documents: Project[];
  activeId: string;
  onSelect: (match: TextMatch, id: string) => void;
  onReplace: (
    matches: TextMatch[],
    replacement: string,
    expected: string,
    id: string,
  ) => Promise<void>;
  onReplaceAll: (
    groups: BookSearchGroup[],
    replacement: string,
  ) => Promise<void>;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current!.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  const sources = documents
    .filter((p) => p.settings.documentKind === "txt")
    .map((p) => ({
      id: p.id,
      title: p.name,
      text: p.book?.chapters.map((c) => c.text).join("\n") || "",
    }));
  const active = sources.find((s) => s.id === activeId) || sources[0];
  return createPortal(
    <dialog
      ref={dialog}
      className="txt-open-find-dialog"
      aria-label="Search open TXT documents"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {error && <p role="alert">{error}</p>}
      {active ? (
        <FindPanel
          text={active.text}
          sourceId={active.id}
          sources={sources}
          initial=""
          selection={{ start: 0, end: 0 }}
          initialWholeScope
          scopeLabels={{
            single: "Current TXT document",
            all: "All open TXT documents",
          }}
          onSelect={onSelect}
          onReplace={onReplace}
          onReplaceBook={onReplaceAll}
          onError={(message) => {
            setError(message);
            onError(message);
          }}
          onClose={onClose}
        />
      ) : (
        <p>
          No TXT documents are open. <button onClick={onClose}>Close</button>
        </p>
      )}
    </dialog>,
    document.body,
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Annotation } from "./types";
import {
  proofreadingHoverIssue,
  proofreadingHoverCandidates,
  proofreadingPointerIssue,
} from "./proofreadingHover";
import ProofreadingPanel, {
  type ProofreadingPanelProps,
} from "./ProofreadingPanel";

type Hover = {
  id: string;
  issue: Annotation;
  element: HTMLElement;
  editor: HTMLElement;
  x: number;
  y: number;
  bottom: number;
  targetId: string;
  sourceText: string;
  configuration: string;
};

export default function ProofreadingPopups(
  props: ProofreadingPanelProps & {
    open: boolean;
    onClose: () => void;
  },
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const controller = useRef(props.controller);
  controller.current = props.controller;
  const reconcile = (current: Hover | null): Hover | null => {
    if (!current || !current.editor.isConnected) return null;
    const result = controller.current.result;
    if (!result || result.targetId !== current.targetId) return null;
    const issue =
      proofreadingHoverIssue(result.annotations, current.id) ||
      result.annotations.find(
        (a) =>
          a.kind === current.issue.kind &&
          a.rule === current.issue.rule &&
          a.start === current.issue.start &&
          a.end === current.issue.end &&
          a.originalText === current.issue.originalText,
      );
    if (!issue)
      return controller.current.revisionBusy &&
        result.sourceText === current.sourceText &&
        result.localConfiguration === current.configuration
        ? current
        : null;
    const anchor = current.editor.querySelector<HTMLElement>(
      `.proofreading-issue-${CSS.escape(issue.id)}, [data-proofreading-id="${CSS.escape(issue.id)}"]`,
    );
    if (!anchor)
      return controller.current.revisionBusy &&
        result.sourceText === current.sourceText &&
        result.localConfiguration === current.configuration
        ? current
        : null;
    if (
      current.element === anchor &&
      current.issue === issue &&
      current.sourceText === result.sourceText
    )
      return current;
    return {
      ...current,
      id: issue.id,
      issue,
      element: anchor,
      sourceText: result.sourceText,
      configuration: result.localConfiguration,
    };
  };
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelHide = () => clearTimeout(hide.current);
  const scheduleHide = () => {
    cancelHide();
    hide.current = setTimeout(() => setHover(null), 300);
  };
  useEffect(() => {
    setHover(null);
    if (props.open) return;
    const over = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".proofreading-hover")) {
        cancelHide();
        return;
      }
      const element = target?.closest<HTMLElement>("[data-proofreading-id]");
      if (!element) {
        scheduleHide();
        return;
      }
      const result = controller.current.result;
      const editor = element.closest<HTMLElement>(
        ".ProseMirror, .txt-host .cm-content",
      );
      const ids: string[] = [];
      for (
        let node: HTMLElement | null = element;
        node && node !== editor;
        node = node.parentElement
      ) {
        if (node.dataset.proofreadingId) ids.push(node.dataset.proofreadingId);
        for (const name of node.classList)
          if (name.startsWith("proofreading-issue-"))
            ids.push(name.slice("proofreading-issue-".length));
      }
      const issue = result && proofreadingPointerIssue(result.annotations, ids);
      if (!result || !issue || !editor) return;
      const anchor =
        editor.querySelector<HTMLElement>(
          `.proofreading-issue-${CSS.escape(issue.id)}, [data-proofreading-id="${CSS.escape(issue.id)}"]`,
        ) || element;
      cancelHide();
      // Use the line under the pointer for wrapped annotations.
      const rects = [...anchor.getClientRects()];
      const rect =
        rects.find(
          (r) => event.clientY >= r.top && event.clientY <= r.bottom,
        ) ?? anchor.getBoundingClientRect();
      setHover((previous) =>
        previous?.element === anchor && previous.id === issue.id
          ? previous
          : {
              id: issue.id,
              issue,
              element: anchor,
              editor,
              x: rect.left,
              y: rect.top,
              bottom: rect.bottom,
              targetId: result.targetId,
              sourceText: result.sourceText,
              configuration: result.localConfiguration,
            },
      );
    };
    const dismiss = () => setHover(null);
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target))
        return;
      dismiss();
    };
    const leave = (event: MouseEvent) => {
      if (!event.relatedTarget) dismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    document.addEventListener("mouseout", leave);
    document.addEventListener("keydown", key);
    return () => {
      cancelHide();
      document.removeEventListener("mouseover", over);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("mouseout", leave);
      document.removeEventListener("keydown", key);
    };
  }, [props.open]);
  useEffect(() => {
    setHover(reconcile);
  }, [props.controller.result, props.controller.revisionBusy]);
  useEffect(() => {
    if (!hover) return;
    const observer = new MutationObserver(() => setHover(reconcile));
    observer.observe(hover.editor, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-proofreading-id", "class"],
    });
    return () => observer.disconnect();
  }, [hover?.editor]);
  useLayoutEffect(() => {
    const node = popup.current;
    if (!node || !hover) return;
    const scale =
      Number(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--ui-scale",
        ),
      ) || 1;
    const position = () => {
      const rect = node.getBoundingClientRect();
      const x = Math.max(8, Math.min(hover.x, innerWidth - rect.width - 8));
      const above = hover.y - rect.height - 6;
      const y =
        above >= 8
          ? above
          : Math.min(innerHeight - rect.height - 8, hover.bottom + 6);
      node.style.left = `${x / scale}px`;
      node.style.top = `${Math.max(8, y) / scale}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hover]);
  useLayoutEffect(() => {
    if (!props.open) return;
    const node = dialog.current!;
    node.show();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      node.close();
    };
  }, [props.open]);
  return createPortal(
    <>
      {props.open && (
        <dialog
          ref={dialog}
          className="proofreading-window"
          aria-label="Spelling and Grammar"
          onCancel={props.onClose}
        >
          <header>
            <h2>Spelling and Grammar</h2>
            <button
              aria-label="Close spelling and grammar"
              onClick={props.onClose}
            >
              ×
            </button>
          </header>
          <div className="proofreading-report-body">
            <ProofreadingPanel
              {...props}
              mode="report"
              onNavigate={props.onClose}
            />
          </div>
        </dialog>
      )}
      {!props.open && hover && (
        <div
          ref={popup}
          className="proofreading-hover"
          role="dialog"
          aria-label="Review underlined issue"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <header className="proofreading-hover-header">
            <strong>
              {hover.issue.kind === "sentence-revision"
                ? "Sentence improvement"
                : "Writing suggestion"}
            </strong>
            <button
              aria-label="Close grammar suggestion"
              onClick={() => setHover(null)}
            >
              ×
            </button>
          </header>
          {props.controller.result &&
            proofreadingHoverCandidates(
              props.controller.result.annotations,
              hover.issue,
            ).length > 1 && (
              <div
                role="group"
                aria-label="Suggestions for this text"
                className="proofreading-hover-choices"
              >
                {proofreadingHoverCandidates(
                  props.controller.result.annotations,
                  hover.issue,
                ).map((issue) => (
                  <button
                    key={issue.id}
                    aria-pressed={issue.id === hover.id}
                    title={issue.originalText || issue.message}
                    onClick={() =>
                      setHover(
                        (current) =>
                          current && { ...current, id: issue.id, issue },
                      )
                    }
                  >
                    {issue.kind === "sentence-revision"
                      ? "Sentence rewrite"
                      : issue.type === "spelling"
                        ? `Spelling: ${issue.originalText}`
                        : issue.message}
                  </button>
                ))}
              </div>
            )}
          {props.controller.revisionBusy && (
            <p role="status">Checking sentence structure…</p>
          )}
          <ProofreadingPanel
            {...props}
            controller={{
              ...props.controller,
              ignore: (id) => {
                props.controller.ignore(id);
                setHover(null);
              },
              result: props.controller.result
                ? { ...props.controller.result, annotations: [hover.issue] }
                : null,
            }}
            mode="hover"
            issueId={hover.id}
          />
        </div>
      )}
    </>,
    document.body,
  );
}

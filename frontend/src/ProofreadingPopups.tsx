import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ProofreadingPanel, {
  type ProofreadingPanelProps,
} from "./ProofreadingPanel";

export default function ProofreadingPopups(
  props: ProofreadingPanelProps & {
    open: boolean;
    onClose: () => void;
  },
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    id: string;
    element: HTMLElement;
    x: number;
    y: number;
  } | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelHide = () => clearTimeout(hide.current);
  const scheduleHide = () => {
    cancelHide();
    hide.current = setTimeout(() => setHover(null), 180);
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
      const id = element.dataset.proofreadingId!;
      if (!props.controller.result?.annotations.some((a) => a.id === id))
        return;
      cancelHide();
      // Use the line under the pointer for wrapped annotations.
      const rects = [...element.getClientRects()];
      const rect =
        rects.find(
          (r) => event.clientY >= r.top && event.clientY <= r.bottom,
        ) ?? element.getBoundingClientRect();
      setHover((previous) =>
        previous?.element === element
          ? previous
          : { id, element, x: rect.left, y: rect.top },
      );
    };
    const dismiss = () => setHover(null);
    const leave = (event: MouseEvent) => {
      if (!event.relatedTarget) dismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    document.addEventListener("mouseout", leave);
    document.addEventListener("keydown", key);
    // Playback and the toolbar toggle remove the decorations; close an open popup too.
    const observer = new MutationObserver(() => {
      setHover((current) =>
        current &&
        (!current.element.isConnected ||
          !current.element.hasAttribute("data-proofreading-id"))
          ? null
          : current,
      );
    });
    document.querySelectorAll(".ProseMirror").forEach((element) =>
      observer.observe(element, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-proofreading-id"],
      }),
    );
    return () => {
      cancelHide();
      observer.disconnect();
      document.removeEventListener("mouseover", over);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("mouseout", leave);
      document.removeEventListener("keydown", key);
    };
  }, [props.open, props.controller.result]);
  useLayoutEffect(() => {
    const node = popup.current;
    if (!node || !hover) return;
    const scale =
      Number(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--ui-scale",
        ),
      ) || 1;
    const rect = node.getBoundingClientRect();
    const x = Math.max(8, Math.min(hover.x, innerWidth - rect.width - 8));
    const above = hover.y - rect.height - 6;
    const y =
      above >= 8
        ? above
        : Math.min(
            innerHeight - rect.height - 8,
            hover.element.getBoundingClientRect().bottom + 6,
          );
    node.style.left = `${x / scale}px`;
    node.style.top = `${Math.max(8, y) / scale}px`;
  }, [hover]);
  useLayoutEffect(() => {
    if (!props.open) return;
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
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
          <ProofreadingPanel {...props} mode="hover" issueId={hover.id} />
        </div>
      )}
    </>,
    document.body,
  );
}

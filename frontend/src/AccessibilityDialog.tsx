import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { AccessibilityIssue } from "./documentAccessibility";
export default function AccessibilityDialog({
  issues,
  scope,
  onGo,
  onClose,
}: {
  issues: AccessibilityIssue[];
  scope: string;
  onGo: (issue: AccessibilityIssue) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>("footer button")?.focus();
    return () => dialog?.close();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="word-dialog accessibility-dialog"
      aria-label="Document accessibility"
      onCancel={onClose}
    >
      <header>
        <strong>Document accessibility</strong>
        <button
          type="button"
          aria-label="Close accessibility checks"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="word-dialog-fields">
        <p role="status">
          {scope} ·{" "}
          {issues.length
            ? `${issues.length} ${issues.length === 1 ? "item" : "items"} to review`
            : "No issues found by these checks"}
        </p>
        <p className="muted">
          Checks cover headings, image descriptions, table headers and link
          wording. Reading order and the quality of descriptions still need
          review.
        </p>
        <ul className="accessibility-issues">
          {issues.map((issue) => (
            <li key={issue.id} data-accessibility-code={issue.code}>
              <strong>{issue.message}</strong>
              <small>{issue.location}</small>
              <p>{issue.detail}</p>
              <button type="button" onClick={() => onGo(issue)}>
                Go to item
              </button>
            </li>
          ))}
        </ul>
      </div>
      <footer>
        <button type="button" className="accent" autoFocus onClick={onClose}>
          Done
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  shapeDefaults,
  shapeDOM,
  shapeKinds,
  shapeProperties,
} from "./documentShapes";
export default function ShapeDialog({
  initial,
  onApply,
  onClose,
}: {
  initial: Record<string, unknown>;
  onApply: (attrs: Record<string, unknown>) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    preview = useRef<HTMLDivElement>(null);
  const [attrs, setAttrs] = useState({ ...shapeDefaults, ...initial }),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    try {
      const node = shapeDOM(attrs);
      node.removeAttribute("contenteditable");
      node.style.maxWidth = "100%";
      node.style.maxHeight = "100%";
      const svg = node.querySelector("svg")!;
      svg.style.width = "100%";
      svg.style.height = "100%";
      preview.current?.replaceChildren(node);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [attrs]);
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog"
      aria-label="Shape properties"
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            shapeProperties(attrs);
            if (onApply(attrs)) onClose();
            else setError("The document changed. Open Shape properties again.");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <header>
          <strong>Shape</strong>
          <button
            type="button"
            aria-label="Close shape properties"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Shape
            <select
              aria-label="Shape kind"
              value={attrs.kind}
              onChange={(e) => setAttrs({ ...attrs, kind: e.target.value })}
            >
              {shapeKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind[0].toUpperCase() + kind.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <div className="word-dialog-row">
            {(["width", "height"] as const).map((key) => (
              <label key={key}>
                {key === "width" ? "Width" : "Height"} (mm)
                <input
                  aria-label={`Shape ${key}`}
                  type="number"
                  min={(8 * 25.4) / 96}
                  max={(2000 * 25.4) / 96}
                  step="any"
                  value={Math.round(((attrs[key] * 25.4) / 96) * 10) / 10}
                  onChange={(e) =>
                    setAttrs({
                      ...attrs,
                      [key]: (Number(e.target.value) * 96) / 25.4,
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="word-dialog-row">
            <label>
              Outline (pt)
              <input
                aria-label="Shape outline width"
                type="number"
                min="0"
                max="9"
                step="0.25"
                value={attrs.strokeWidth * 0.75}
                onChange={(e) =>
                  setAttrs({
                    ...attrs,
                    strokeWidth: Number(e.target.value) / 0.75,
                  })
                }
              />
            </label>
            <label>
              Outline colour
              <input
                aria-label="Shape outline colour"
                type="color"
                value={attrs.stroke}
                onChange={(e) => setAttrs({ ...attrs, stroke: e.target.value })}
              />
            </label>
          </div>
          <div className="word-dialog-row">
            <label>
              Fill
              <input
                type="checkbox"
                checked={attrs.fill !== "none"}
                disabled={attrs.kind === "line"}
                onChange={(e) =>
                  setAttrs({
                    ...attrs,
                    fill: e.target.checked ? "#ffffff" : "none",
                  })
                }
              />
            </label>
            <label>
              Fill colour
              <input
                aria-label="Shape fill colour"
                type="color"
                disabled={attrs.kind === "line" || attrs.fill === "none"}
                value={attrs.fill === "none" ? "#ffffff" : attrs.fill}
                onChange={(e) => setAttrs({ ...attrs, fill: e.target.value })}
              />
            </label>
          </div>
          <label>
            Description
            <input
              aria-label="Shape description"
              value={attrs.alt}
              maxLength={4096}
              disabled={attrs.decorative}
              onChange={(e) => setAttrs({ ...attrs, alt: e.target.value })}
            />
          </label>
          <label>
            Decorative
            <input
              type="checkbox"
              checked={attrs.decorative}
              onChange={(e) =>
                setAttrs({ ...attrs, decorative: e.target.checked })
              }
            />
          </label>
          <div
            ref={preview}
            className="shape-preview"
            aria-label="Shape preview"
          />
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!!error}>
            Apply
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { bulletMarkers, numberedMarkers } from "./listFormatting";
import {
  defaultListTemplate,
  validListTemplate,
  nextListLabel,
  type ListTemplate,
  type ListLevel,
} from "./outlineLists";
import "./word-processing.css";

export default function ListDialog({
  ordered,
  initial,
  onApply,
  onClose,
}: {
  ordered: boolean;
  initial: {
    order: number;
    listStyle: string;
    index: number;
    continuePrevious: boolean;
    template?: ListTemplate | null;
    outlineLevel?: number;
    outlineOrder?: number;
    outlineContinuation?: boolean;
  };
  onApply: (
    listStyle: string,
    order: number,
    fromItem: boolean,
    continuation: boolean,
    template?: ListTemplate | null,
  ) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [marker, setMarker] = useState(initial.listStyle);
  const [order, setOrder] = useState(
    String(initial.template ? initial.outlineOrder || 1 : initial.order),
  );
  const [fromItem, setFromItem] = useState(false);
  const [continuation, setContinuation] = useState(
    initial.template ? !!initial.outlineContinuation : initial.continuePrevious,
  );
  const [outline, setOutline] = useState(!!initial.template),
    [template, setTemplate] = useState<ListTemplate>(() =>
      structuredClone(initial.template || defaultListTemplate()),
    ),
    [level, setLevel] = useState(initial.outlineLevel || 0);
  const current = template[level];
  const patch = (values: Partial<ListLevel>) =>
    setTemplate((old) =>
      old.map((item, index) =>
        index === level ? { ...item, ...values } : item,
      ),
    );
  const preview = () => {
    const counts = Array<number | null>(9).fill(null);
    counts[0] = Number(order) - 1;
    return Array.from({ length: level + 1 }, (_, i) =>
      nextListLabel(template, counts, i),
    ).join("  ");
  };
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const labels: Record<string, string> = {
    decimal: "1, 2, 3",
    "lower-alpha": "a, b, c",
    "upper-alpha": "A, B, C",
    "lower-roman": "i, ii, iii",
    "upper-roman": "I, II, III",
    disc: "Solid circle",
    circle: "Open circle",
    square: "Square",
  };
  return createPortal(
    <dialog
      className="word-dialog"
      aria-label="List"
      ref={dialog}
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(
            marker,
            Number(order),
            fromItem,
            continuation,
            outline ? template : initial.template ? null : undefined,
          );
        }}
      >
        <header>
          <strong>List</strong>
          <button
            type="button"
            aria-label="Close list settings"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Numbering style
            <select
              aria-label="List structure"
              value={outline ? "outline" : "ordinary"}
              onChange={(e) => {
                const enabled = e.target.value === "outline";
                setOutline(enabled);
                setOrder(
                  String(
                    enabled
                      ? initial.outlineOrder || initial.order
                      : initial.order,
                  ),
                );
                setContinuation(
                  enabled
                    ? !!initial.outlineContinuation
                    : initial.continuePrevious,
                );
              }}
            >
              <option value="ordinary">Ordinary list</option>
              <option value="outline">Outline numbering</option>
            </select>
          </label>
          {outline && (
            <>
              <label>
                Level
                <select
                  aria-label="Outline level"
                  value={level}
                  onChange={(e) => setLevel(Number(e.target.value))}
                >
                  {template.map((_, i) => (
                    <option key={i} value={i}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Number format
                <select
                  aria-label="Outline number format"
                  value={current.format}
                  onChange={(e) => {
                    const format = e.target.value;
                    patch({
                      format,
                      ...((bulletMarkers as readonly string[]).includes(format)
                        ? {
                            pattern: (
                              { disc: "•", circle: "○", square: "▪" } as Record<
                                string,
                                string
                              >
                            )[format],
                          }
                        : {}),
                    });
                  }}
                >
                  {[...numberedMarkers, ...bulletMarkers].map((value) => (
                    <option key={value} value={value}>
                      {labels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Pattern
                <input
                  aria-label="Outline number pattern"
                  value={current.pattern}
                  maxLength={80}
                  onChange={(e) => patch({ pattern: e.target.value })}
                />
              </label>
              <small>
                Use %1 for the first level’s number, %2 for the second, and so
                on. Punctuation and other text are kept.
              </small>
              <label>
                Level start
                <input
                  aria-label="Outline level start"
                  type="number"
                  required
                  min={1}
                  max={100000}
                  step={1}
                  value={
                    level === 0
                      ? order
                      : Number.isFinite(current.start)
                        ? current.start
                        : ""
                  }
                  onChange={(e) => {
                    patch({ start: Number(e.target.value) });
                    if (level === 0) setOrder(e.target.value);
                  }}
                />
              </label>
              {level > 0 && (
                <label>
                  Restart after
                  <select
                    aria-label="Outline restart"
                    value={current.restart}
                    onChange={(e) => patch({ restart: Number(e.target.value) })}
                  >
                    <option value={0}>Never</option>
                    {Array.from({ length: level }, (_, i) => (
                      <option key={i} value={i + 1}>
                        Level {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Indent (pt)
                <input
                  aria-label="Outline indent"
                  type="number"
                  required
                  min={0}
                  max={288}
                  step={0.5}
                  value={Number.isFinite(current.indent) ? current.indent : ""}
                  onChange={(e) => patch({ indent: Number(e.target.value) })}
                />
              </label>
              <label>
                Hanging (pt)
                <input
                  aria-label="Outline hanging indent"
                  type="number"
                  required
                  min={0}
                  max={Math.min(144, current.indent)}
                  step={0.5}
                  value={
                    Number.isFinite(current.hanging) ? current.hanging : ""
                  }
                  onChange={(e) => patch({ hanging: Number(e.target.value) })}
                />
              </label>
              <p className="reference-preview" aria-label="Outline preview">
                {validListTemplate(template)
                  ? preview()
                  : "Choose a valid pattern and indentation."}
              </p>
              <small>
                Applies to this complete list and its nested levels.
              </small>
            </>
          )}
          {!outline && (
            <>
              <label>
                Markers
                <select
                  aria-label="List markers"
                  value={marker}
                  onChange={(event) => setMarker(event.target.value)}
                >
                  {(ordered ? numberedMarkers : bulletMarkers).map((value) => (
                    <option key={value} value={value}>
                      {labels[value]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {(ordered || outline) && (
            <label>
              Numbering
              <select
                aria-label="List numbering"
                value={continuation ? "continue" : "restart"}
                onChange={(e) => setContinuation(e.target.value === "continue")}
              >
                <option value="restart">Start at</option>
                <option value="continue">Continue previous list</option>
              </select>
            </label>
          )}
          {ordered && !outline && !continuation && (
            <label>
              Start at
              <input
                aria-label="List start"
                type="number"
                required
                min={1}
                max={100000}
                step={1}
                value={order}
                onChange={(event) => setOrder(event.target.value)}
              />
            </label>
          )}
          {!outline && initial.index > 0 && (
            <label>
              Apply to
              <select
                aria-label="List scope"
                value={String(fromItem)}
                onChange={(event) => setFromItem(event.target.value === "true")}
              >
                <option value="false">Whole list</option>
                <option value="true">From this item</option>
              </select>
            </label>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="accent"
            type="submit"
            disabled={outline && !validListTemplate(template)}
          >
            Apply
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

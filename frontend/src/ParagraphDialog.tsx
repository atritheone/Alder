import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { paragraphProperties } from "./editorCommands";
import { styleDeclarations } from "./styleResolution";
import type { StyleProperties } from "./types";
import "./word-processing.css";

export default function ParagraphDialog({
  initial,
  onApply,
  onClose,
}: {
  initial: Record<string, unknown>;
  onApply: (values: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      paragraphProperties.map((key) => [
        key,
        initial[key] == null ? "" : String(initial[key]),
      ]),
    ),
  );
  const [changed, setChanged] = useState<Record<string, unknown>>({});
  const preview = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (preview.current)
      preview.current.style.cssText = styleDeclarations({
        ...initial,
        ...changed,
      } as StyleProperties);
  }, [initial, changed]);
  const edit = (key: string, value: string) => {
    setValues((old) => ({ ...old, [key]: value }));
    setChanged((old) => ({
      ...old,
      [key]:
        value === ""
          ? null
          : ["align", "lineSpacingMode"].includes(key)
            ? value
            : [
                  "keepWithNext",
                  "keepTogether",
                  "widowOrphan",
                  "pageBreakBefore",
                ].includes(key)
              ? value === "true"
              : Number(value),
    }));
  };
  return createPortal(
    <dialog
      className="word-dialog"
      aria-labelledby="paragraph-title"
      ref={dialog}
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(changed);
        }}
      >
        <header>
          <strong id="paragraph-title">Paragraph</strong>
          <button
            type="button"
            aria-label="Close paragraph settings"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Line spacing mode
            <select
              aria-label="Line spacing mode"
              value={values.lineSpacingMode}
              onChange={(e) => edit("lineSpacingMode", e.target.value)}
            >
              <option value="">Inherited / mixed</option>
              <option value="multiple">Multiple</option>
              <option value="exact">Exactly</option>
              <option value="atLeast">At least</option>
            </select>
          </label>
          {["exact", "atLeast"].includes(values.lineSpacingMode) && (
            <label>
              Line spacing (pt)
              <input
                aria-label="Line spacing (pt)"
                type="number"
                min={1}
                max={144}
                step={0.5}
                required
                value={values.lineSpacing}
                onChange={(e) => edit("lineSpacing", e.target.value)}
              />
            </label>
          )}
          <label>
            Alignment
            <select
              aria-label="Paragraph alignment"
              value={values.align}
              onChange={(e) => edit("align", e.target.value)}
            >
              <option value="">Inherited / mixed</option>
              {["left", "center", "right", "justify"].map((a) => (
                <option key={a} value={a}>
                  {a === "center" ? "Centre" : a[0].toUpperCase() + a.slice(1)}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["leftIndent", "Left indent (pt)", -144, 144, 1],
              ["rightIndent", "Right indent (pt)", -144, 144, 1],
              [
                "firstLineIndent",
                "First line / hanging indent (pt)",
                -144,
                144,
                1,
              ],
              ["spaceBefore", "Space before (pt)", 0, 144, 1],
              ["spaceAfter", "Space after (pt)", 0, 144, 1],
              ["lineHeight", "Line spacing (multiple)", 0.8, 4, 0.1],
            ] as const
          )
            .filter(
              ([key]) =>
                key !== "lineHeight" ||
                !["exact", "atLeast"].includes(values.lineSpacingMode),
            )
            .map(([key, label, min, max, step]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={label}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  placeholder="Inherited / mixed"
                  value={values[key]}
                  onChange={(e) => edit(key, e.target.value)}
                />
              </label>
            ))}
          {(
            [
              ["keepWithNext", "Keep with next paragraph"],
              ["keepTogether", "Keep lines together"],
              ["widowOrphan", "Widow and orphan control"],
              ["pageBreakBefore", "Page break before"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <select
                aria-label={label}
                value={values[key]}
                onChange={(e) => edit(key, e.target.value)}
              >
                <option value="">Inherited / mixed</option>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </label>
          ))}
        </div>
        <div className="paragraph-preview" aria-label="Paragraph preview">
          <p ref={preview}>
            A paragraph can have its own alignment, spacing and indentation.
            Negative first-line indentation creates a hanging indent.
          </p>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="accent" type="submit">
            Apply
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

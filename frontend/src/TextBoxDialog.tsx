import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import StoryEditor from "./StoryEditor";
import { textBoxDefaults, textBoxProperties } from "./textBoxes";
import type { DocNode } from "./types";

export default function TextBoxDialog({
  initial,
  onApply,
  onClose,
}: {
  initial: DocNode;
  onApply: (attrs: Record<string, any>, content: DocNode[]) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [attrs, setAttrs] = useState({ ...textBoxDefaults, ...initial.attrs });
  const [body, setBody] = useState<DocNode>({
    type: "doc",
    content: [{ type: "paragraph", content: initial.content || [] }],
  });
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog running-matter-dialog"
      aria-label="Text box properties"
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            textBoxProperties(attrs);
            if (onApply(attrs, body.content?.[0].content || [])) onClose();
            else
              setError("The document changed. Open Text box properties again.");
          } catch (e) {
            setError(String((e as Error).message));
          }
        }}
      >
        <header>
          <strong>Text box</strong>
          <button
            type="button"
            aria-label="Close text box properties"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <div className="word-dialog-row">
            <label>
              Placement
              <select
                aria-label="Text box placement"
                value={attrs.wrap}
                onChange={(e) => setAttrs({ ...attrs, wrap: e.target.value })}
              >
                <option value="none">In line with text</option>
                <option value="left">Wrap text · left</option>
                <option value="right">Wrap text · right</option>
              </select>
            </label>
            <label>
              Alignment
              <select
                aria-label="Text box alignment"
                value={attrs.align}
                onChange={(e) => setAttrs({ ...attrs, align: e.target.value })}
              >
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
                <option value="justify">Justify</option>
              </select>
            </label>
          </div>
          <div className="word-dialog-row">
            {(
              [
                ["width", "Width", 24, 2000],
                ["minHeight", "Minimum height", 0, 2000],
                ["padding", "Inset", 0, 96],
                ["wrapGap", "Text spacing", 0, 192],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label} (mm)
                <input
                  aria-label={`Text box ${label.toLowerCase()}`}
                  type="number"
                  step="any"
                  min={(min * 25.4) / 96}
                  max={(max * 25.4) / 96}
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
              Border (pt)
              <input
                aria-label="Text box border width"
                type="number"
                min="0"
                max="9"
                step="0.25"
                value={attrs.borderWidth * 0.75}
                onChange={(e) =>
                  setAttrs({
                    ...attrs,
                    borderWidth: Number(e.target.value) / 0.75,
                  })
                }
              />
            </label>
            {(
              [
                ["borderColor", "Border"],
                ["fill", "Fill"],
                ["color", "Text"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={`Text box ${label.toLowerCase()} colour`}
                  type="color"
                  value={attrs[key]}
                  onChange={(e) =>
                    setAttrs({ ...attrs, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <StoryEditor
            mode="textBox"
            document={body}
            onChange={setBody}
            styles={[]}
            fontFamily={attrs.fontFamily}
            fields={{} as any}
            label="Text box text"
            language="en"
            assets={[]}
            projectId=""
            onCollect={async () => {
              throw new Error("Text boxes contain text.");
            }}
          />
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Apply
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

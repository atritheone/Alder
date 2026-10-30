import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import StoryEditor from "./StoryEditor";
import { formFieldDefaults, formFieldProperties } from "./formFields";
import type { DocNode, Asset, NamedStyle } from "./types";

const wording = (nodes: DocNode[]) =>
  nodes.map((n) => (n.type === "hard_break" ? "\n" : n.text || "")).join("");
const textNodes = (value: string): DocNode[] =>
  value
    .split("\n")
    .flatMap((line, i) => [
      ...(i ? [{ type: "hard_break" }] : []),
      ...(line ? [{ type: "text", text: line }] : []),
    ]);
export default function FormFieldDialog({
  initial,
  assets,
  styles,
  projectId,
  onCollect,
  onApply,
  onClose,
}: {
  initial: DocNode;
  assets: Asset[];
  styles: NamedStyle[];
  projectId: string;
  onCollect: (file: File) => Promise<Asset>;
  onApply: (
    attrs: Record<string, any>,
    content: DocNode[],
    block: boolean,
  ) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [attrs, setAttrs] = useState({
    ...formFieldDefaults,
    ...initial.attrs,
  });
  const [block, setBlock] = useState(initial.type === "form_block");
  const [body, setBody] = useState<DocNode>({
    type: "doc",
    content:
      initial.type === "form_block"
        ? initial.content
        : [{ type: "paragraph", content: initial.content || [] }],
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
      aria-label="Form field properties"
      onCancel={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            formFieldProperties(attrs);
            if (
              onApply(
                attrs,
                (block ? body.content : body.content?.[0].content) || [],
                block,
              )
            )
              onClose();
            else
              setError(
                "The field could not be changed. Close this window and check the document status.",
              );
          } catch (cause) {
            setError((cause as Error).message);
          }
        }}
      >
        <header>
          <strong>Form field</strong>
          <button
            type="button"
            aria-label="Close form field properties"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <div className="word-dialog-row">
            <label>
              Type
              <select
                aria-label="Field type"
                value={block ? "richBlock" : attrs.kind}
                disabled={attrs.lockContent || initial.type === "form_block"}
                onChange={(e) => {
                  const kind =
                    e.target.value === "richBlock" ? "rich" : e.target.value;
                  const nextBlock = e.target.value === "richBlock";
                  if (block && !nextBlock) {
                    // Existing block fields keep their type. For a new field,
                    // switching back is only offered while it is one paragraph.
                    if (
                      body.content?.length !== 1 ||
                      body.content[0].type !== "paragraph"
                    ) {
                      setError(
                        "Keep this as a block field to retain its paragraphs and objects.",
                      );
                      return;
                    }
                  }
                  setBlock(nextBlock);
                  if (kind === "plain")
                    setBody({
                      type: "doc",
                      content: [
                        {
                          type: "paragraph",
                          content: textNodes(
                            wording(body.content?.[0].content || []),
                          ),
                        },
                      ],
                    });
                  setAttrs({ ...attrs, kind });
                }}
              >
                <option value="plain">Plain text</option>
                <option value="rich">Rich text · inline</option>
                <option
                  value="richBlock"
                  disabled={
                    !!initial.attrs?.blockId && initial.type !== "form_block"
                  }
                >
                  Rich text · block
                </option>
                <option value="checkbox">Checkbox</option>
                <option value="date">Date</option>
              </select>
            </label>
            <label>
              Name
              <input
                aria-label="Field name"
                value={attrs.label}
                maxLength={200}
                onChange={(e) => setAttrs({ ...attrs, label: e.target.value })}
              />
            </label>
            <label>
              Tag
              <input
                aria-label="Field tag"
                value={attrs.tag}
                maxLength={200}
                onChange={(e) => setAttrs({ ...attrs, tag: e.target.value })}
              />
            </label>
          </div>
          <fieldset className="form-field-value" disabled={attrs.lockContent}>
            {attrs.kind === "plain" && (
              <label>
                Text
                <textarea
                  aria-label="Field text"
                  rows={5}
                  value={wording(body.content?.[0].content || [])}
                  onChange={(e) =>
                    setBody({
                      type: "doc",
                      content: [
                        {
                          type: "paragraph",
                          content: textNodes(e.target.value),
                        },
                      ],
                    })
                  }
                />
              </label>
            )}
            {attrs.kind === "rich" && (
              <div inert={attrs.lockContent}>
                <StoryEditor
                  key={block ? "block" : "inline"}
                  mode={block ? "formBlock" : "form"}
                  document={body}
                  onChange={setBody}
                  styles={styles}
                  fontFamily="Cambria"
                  fields={{} as any}
                  label="Field text"
                  language="en"
                  assets={assets}
                  projectId={projectId}
                  onCollect={onCollect}
                />
              </div>
            )}
            {attrs.kind === "checkbox" && (
              <label>
                <input
                  type="checkbox"
                  aria-label="Checked"
                  checked={attrs.checked}
                  onChange={(e) =>
                    setAttrs({ ...attrs, checked: e.target.checked })
                  }
                />
                Checked
              </label>
            )}
            {attrs.kind === "date" && (
              <label>
                Date
                <input
                  aria-label="Field date"
                  type="date"
                  min="0001-01-01"
                  max="9999-12-31"
                  value={attrs.dateValue}
                  onChange={(e) =>
                    setAttrs({ ...attrs, dateValue: e.target.value })
                  }
                />
              </label>
            )}
          </fieldset>
          <div className="word-dialog-row">
            <label>
              <input
                type="checkbox"
                checked={attrs.lockContent}
                onChange={(e) =>
                  setAttrs({ ...attrs, lockContent: e.target.checked })
                }
              />
              Lock content
            </label>
            <label>
              <input
                type="checkbox"
                checked={attrs.lockDelete}
                onChange={(e) =>
                  setAttrs({ ...attrs, lockDelete: e.target.checked })
                }
              />
              Prevent deletion
            </label>
          </div>
          <p className="muted">
            Editing restrictions can be changed here. They do not encrypt or
            password-protect the document.
          </p>
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

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { compileEquation, mathLatex, parseMath } from "./equations";
import type { DocNode } from "./types";

export default function EquationDialog({
  initial,
  onApply,
  onClose,
}: {
  initial: DocNode;
  onApply: (attrs: Record<string, any>, description: string) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    host = useRef<HTMLDivElement>(null),
    field = useRef<any>(null),
    serial = useRef(0);
  const [description, setDescription] = useState(
      initial.content?.[0]?.text || "",
    ),
    manual = useRef(!!initial.content?.[0]?.text);
  const [formula, setFormula] = useState<{
    mathML: string;
    latex: string;
  } | null>(
    initial.attrs?.mathML
      ? { mathML: initial.attrs.mathML, latex: initial.attrs.latex || "" }
      : null,
  );
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [pending, setPending] = useState(false);
  const [display,setDisplay]=useState(initial.attrs?.mathML?parseMath(initial.attrs.mathML).getAttribute('display')==='block':false);
  const displayRef=useRef(display),refresh=useRef<()=>Promise<void>>(async()=>{});
  useEffect(() => {
    let disposed = false;
    dialog.current?.showModal();
    void (async () => {
      try {
        const { MathfieldElement } = await import("mathlive");
        if (disposed) return;
        MathfieldElement.fontsDirectory = null;
        MathfieldElement.soundsDirectory = null;
        const editor = new MathfieldElement();
        field.current = editor;
        editor.mathVirtualKeyboardPolicy = "manual";
        editor.setAttribute("aria-label", "Equation formula");
        editor.value = initial.attrs?.mathML
          ? mathLatex(parseMath(initial.attrs.mathML))
          : "x^2";
        const update = async () => {
          const ticket = ++serial.current;
          setPending(true);
          try {
            const next = await compileEquation(editor.value,displayRef.current);
            if (disposed || ticket !== serial.current) return;
            setFormula(next);
            if (!manual.current) setDescription(next.description);
            setError("");
          } catch (cause) {
            if (!disposed && ticket === serial.current) {
              setFormula(null);
              setError((cause as Error).message);
            }
          } finally {
            if (!disposed && ticket === serial.current) setPending(false);
          }
        };
        editor.addEventListener("input", () => void update());
        refresh.current=update;
        host.current?.append(editor);
        setReady(true);
        // Opening existing equations is lossless until the user edits them.
        if (!initial.attrs?.mathML) await update();
        editor.focus();
      } catch (cause) {
        if (!disposed) setError((cause as Error).message);
      }
    })();
    return () => {
      disposed = true;
      serial.current++;
      field.current?.remove();
      dialog.current?.close();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog equation-dialog"
      aria-label="Equation properties"
      onCancel={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!formula || pending) return;
          try {
            if (onApply(formula, description)) onClose();
            else
              setError(
                "The document changed. Close this window and open the equation again.",
              );
          } catch (cause) {
            setError((cause as Error).message);
          }
        }}
      >
        <header>
          <strong>Equation</strong>
          <button
            type="button"
            aria-label="Close equation properties"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>Placement<select aria-label="Equation placement" disabled={!ready} value={display?'display':'inline'} onChange={e=>{const next=e.target.value==='display';displayRef.current=next;setDisplay(next);void refresh.current();}}><option value="inline">Inline</option><option value="display">Own paragraph</option></select></label>
          <div ref={host} />
          {!ready && !error && <p>Loading equation editor…</p>}
          <p>
            Type a formula, or use LaTeX such as{" "}
            <code>\frac&#123;a&#125;&#123;b&#125;</code>. Use the arrow keys to
            move between its parts.
          </p>
          {formula && (
            <div
              className="equation-preview"
              aria-label="Equation preview"
              dangerouslySetInnerHTML={{ __html: formula.mathML }}
            />
          )}
          <label>
            Reading description
            <textarea
              aria-label="Equation reading description"
              rows={3}
              value={description}
              maxLength={4096}
              onChange={(e) => {
                manual.current = true;
                setDescription(e.target.value);
              }}
            />
          </label>
          <p>
            This description is used for narration, text exports and assistive
            technology.
          </p>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!ready || !formula || pending || !description.trim()}
          >
            Apply
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

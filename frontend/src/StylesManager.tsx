import { useInstalledFonts } from "./useInstalledFonts";
import { useState, type CSSProperties } from "react";
import { Plus, Trash2, Edit3, Copy } from "lucide-react";
import type { NamedStyle, Project, StyleKind, StyleProperties } from "./types";
import { uid } from "./api";
import { resolveStyles, styleUsageCount } from "./styleResolution";
import "./styles-manager.css";

type Props = {
  project: Project;
  onChange: (fn: (project: Project) => void) => void;
  onApply: (id: string, kind: StyleKind) => void;
  onError: (message: string) => void;
};
const fields: {
  key: keyof StyleProperties;
  label: string;
  min: number;
  max: number;
  step: number;
  paragraph?: boolean;
}[] = [
  { key: "fontSize", label: "Font size (pt)", min: 6, max: 72, step: 0.5 },
  {
    key: "lineHeight",
    label: "Line height (multiple)",
    min: 1,
    max: 3,
    step: 0.1,
    paragraph: true,
  },
  {
    key: "spaceAfter",
    label: "Space after (pt)",
    min: 0,
    max: 144,
    step: 1,
    paragraph: true,
  },
  {
    key: "leftIndent",
    label: "Left indent (pt)",
    min: -144,
    max: 144,
    step: 1,
    paragraph: true,
  },
  {
    key: "firstLineIndent",
    label: "First line indent (pt)",
    min: -144,
    max: 144,
    step: 1,
    paragraph: true,
  },
];

export default function StylesManager({
  project,
  onChange,
  onApply,
  onError,
}: Props) {
  const [editing, setEditing] = useState<NamedStyle | null>(null);
  const installedFonts = useInstalledFonts(
    editing?.fontFamily || project.settings.fontFamily,
  );
  const styles = project.styles;
  const save = () => {
    if (!editing) return;
    const style = { ...editing, name: editing.name.trim() };
    const next = styles.some((item) => item.id === style.id)
      ? styles.map((item) => (item.id === style.id ? style : item))
      : [...styles, style];
    try {
      resolveStyles(next);
      onChange((p) => {
        p.styles = next;
      });
      setEditing(null);
    } catch (error) {
      onError((error as Error).message);
    }
  };
  const remove = (style: NamedStyle) => {
    const dependents = styles.filter((item) => item.basedOn === style.id),
      uses = styleUsageCount(project, style.id);
    if (dependents.length || uses) {
      onError(
        `“${style.name}” is used by ${uses} text ${uses === 1 ? "range" : "ranges"} and ${dependents.length} inherited ${dependents.length === 1 ? "style" : "styles"}. Apply another style to that text and change those base styles before deleting it.`,
      );
      return;
    }
    onChange((p) => {
      p.styles = p.styles.filter((item) => item.id !== style.id);
    });
    if (editing?.id === style.id) setEditing(null);
  };
  let resolutionError = "";
  try {
    resolveStyles(styles);
  } catch (error) {
    resolutionError = (error as Error).message;
  }
  const draftStyles = editing
    ? styles.some((s) => s.id === editing.id)
      ? styles.map((s) => (s.id === editing.id ? editing : s))
      : [...styles, editing]
    : styles;
  let resolved: NamedStyle | undefined;
  if (editing) {
    try {
      resolved = resolveStyles(draftStyles).get(editing.id);
    } catch {
      /* Save reports the specific invalid inheritance. */
    }
  }
  const preview: CSSProperties = {
    fontFamily: resolved?.fontFamily || project.settings.fontFamily,
    fontSize: resolved?.fontSize ? `${resolved.fontSize}pt` : undefined,
    lineHeight: resolved?.lineHeight || undefined,
    color: resolved?.color || undefined,
    textAlign: resolved?.align || undefined,
    marginLeft: resolved?.leftIndent ? `${resolved.leftIndent}pt` : undefined,
    textIndent: resolved?.firstLineIndent
      ? `${resolved.firstLineIndent}pt`
      : undefined,
  };
  return (
    <div className="styles-manager">
      <p className="quiet">
        Paragraph styles shape whole paragraphs. Character styles shape selected
        words. Changes update every linked use; direct formatting takes
        precedence. Leave a field blank to inherit it.
      </p>
      {resolutionError && (
        <p role="alert" className="style-warning">
          {resolutionError}
        </p>
      )}
      <div className="manager-actions">
        <button
          className="accent"
          onClick={() =>
            setEditing({
              id: uid(),
              name: "New paragraph style",
              kind: "paragraph",
            })
          }
        >
          <Plus size={13} />
          New paragraph style
        </button>
        <button
          onClick={() =>
            setEditing({
              id: uid(),
              name: "New character style",
              kind: "character",
            })
          }
        >
          <Plus size={13} />
          New character style
        </button>
      </div>
      <div className="style-list">
        {styles.map((style) => (
          <div className="style-row" key={style.id}>
            <div>
              <strong>{style.name}</strong>
              <small>
                {style.kind || "paragraph"}
                {style.basedOn
                  ? ` · based on ${styles.find((item) => item.id === style.basedOn)?.name || "missing style"}`
                  : ""}
              </small>
            </div>
            <button
              onClick={() => onApply(style.id, style.kind || "paragraph")}
              aria-label={`Apply ${style.name}`}
            >
              Apply
            </button>
            <button
              title={`Edit ${style.name}`}
              aria-label={`Edit ${style.name}`}
              onClick={() => setEditing({ ...style })}
            >
              <Edit3 size={13} />
            </button>
            <button
              title={`Duplicate ${style.name}`}
              aria-label={`Duplicate ${style.name}`}
              onClick={() =>
                setEditing({ ...style, id: uid(), name: `${style.name} copy` })
              }
            >
              <Copy size={13} />
            </button>
            <button
              title={`Delete ${style.name}`}
              aria-label={`Delete ${style.name}`}
              onClick={() => remove(style)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="manager-actions">
        <button onClick={() => onApply("", "paragraph")}>
          Clear paragraph style
        </button>
        <button onClick={() => onApply("", "character")}>
          Clear character style
        </button>
      </div>
      {editing && (
        <section className="style-editor" aria-label="Style settings">
          <strong>
            {styles.some((style) => style.id === editing.id)
              ? "Edit style"
              : "New style"}
          </strong>
          <div className="style-fields">
            <label>
              Name
              <input
                aria-label="Style name"
                value={editing.name}
                maxLength={150}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
              />
            </label>
            <label>
              Kind
              <select
                aria-label="Style kind"
                value={editing.kind || "paragraph"}
                disabled={
                  styles.some((style) => style.id === editing.id) &&
                  styleUsageCount(project, editing.id) > 0
                }
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    kind: event.target.value as StyleKind,
                    basedOn: null,
                  })
                }
              >
                <option value="paragraph">Paragraph</option>
                <option value="character">Character</option>
              </select>
            </label>
            <label>
              Based on
              <select
                aria-label="Base style"
                value={editing.basedOn || ""}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    basedOn: event.target.value || null,
                  })
                }
              >
                <option value="">No base style</option>
                {styles
                  .filter(
                    (style) =>
                      style.id !== editing.id &&
                      (style.kind || "paragraph") ===
                        (editing.kind || "paragraph"),
                  )
                  .map((style) => (
                    <option key={style.id} value={style.id}>
                      {style.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Font family
              <input
                aria-label="Style font family"
                list="alder-style-fonts"
                value={editing.fontFamily || ""}
                placeholder={resolved?.fontFamily || "Inherit"}
                maxLength={200}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    fontFamily: event.target.value || null,
                  })
                }
              />
              <datalist id="alder-style-fonts">
                {installedFonts.map((font) => (
                  <option key={font} value={font} />
                ))}
              </datalist>
            </label>
            {fields
              .filter(
                (field) =>
                  !field.paragraph ||
                  (editing.kind || "paragraph") === "paragraph",
              )
              .map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    aria-label={`Style ${field.label}`}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={editing[field.key] ?? ""}
                    placeholder={
                      resolved?.[field.key] === undefined
                        ? "Inherit"
                        : String(resolved[field.key])
                    }
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        [field.key]:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                  />
                </label>
              ))}
            <label>
              Colour
              <input
                aria-label="Style colour"
                value={editing.color || ""}
                placeholder={resolved?.color || "Inherit (e.g. #243b36)"}
                onChange={(event) =>
                  setEditing({ ...editing, color: event.target.value || null })
                }
              />
            </label>
            {(editing.kind || "paragraph") === "paragraph" && (
              <label>
                Alignment
                <select
                  aria-label="Style alignment"
                  value={editing.align || ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      align: (event.target.value ||
                        null) as NamedStyle["align"],
                    })
                  }
                >
                  <option value="">Inherit</option>
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                  <option value="justify">Justified</option>
                </select>
              </label>
            )}
          </div>
          <div className="style-preview">
            <small>Style preview</small>
            <p style={preview}>
              The words found their shape in the quiet of the morning.
            </p>
          </div>
          <footer>
            <span>Spacing and indentation use points.</span>
            <button onClick={() => setEditing(null)}>Cancel</button>
            <button className="accent" onClick={save}>
              Save style
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}

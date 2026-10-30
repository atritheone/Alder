import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import StoryEditor from "./StoryEditor";
import {
  emptyStory,
  resolveRunningMatter,
  storyVariants,
  validRunningMatter,
  storyDocuments,
  runningFieldValues,
  type RunningMatter,
  type StoryPart,
  type StoryVariant,
} from "./runningMatter";
import type { Project } from "./types";
import { prepareRunningImages } from "./runningImages";

export default function RunningMatterDialog({
  project,
  initial,
  previous,
  section = false,
  initialPart = "header",
  initialVariant = "default",
  onApply,
  onClose,
  onCollect,
}: {
  project: Project;
  initial: RunningMatter;
  previous: RunningMatter;
  section?: boolean;
  initialPart?: StoryPart;
  initialVariant?: StoryVariant;
  onApply: (value: RunningMatter) => void;
  onClose: () => void;
  onCollect: (file: File) => Promise<import("./types").Asset>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [value, setValue] = useState<RunningMatter>(() => structuredClone(initial)),
    [part, setPart] = useState<StoryPart>(initialPart),
    [variant, setVariant] = useState<StoryVariant>(initialVariant),
    [editorVersion, setEditorVersion] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const [error, setError] = useState("");
  const latestValue = useRef(value);
  latestValue.current = value;
  const resolved = resolveRunningMatter(previous, value),
    linked = section && !Object.hasOwn(value[part] || {}, variant);
  useEffect(() => {
    if (
      (variant === "first" && !resolved.differentFirst) ||
      (variant === "even" && !resolved.differentEven)
    )
      setVariant("default");
  }, [variant, resolved.differentFirst, resolved.differentEven]);
  const updateStory = (document: import("./types").DocNode | null) =>
    setValue((v) => ({ ...v, [part]: { ...v[part], [variant]: document } }));
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog running-matter-dialog"
      aria-label="Headers and footers"
      onCancel={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await prepareRunningImages(storyDocuments(resolved));
            if (!dialog.current?.open) return;
            if (latestValue.current !== value)
              throw new Error(
                "The header or footer changed while its images were loading. Apply again.",
              );
            if (validRunningMatter(value, section)) onApply(value);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <header>
          <strong>Headers and footers</strong>
          <button
            type="button"
            aria-label="Close headers and footers"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <p>{section ? "Current section" : "Document"}</p>
          <div className="story-options">
            <label>
              <input
                type="checkbox"
                checked={!!resolved.differentFirst}
                onChange={(e) =>
                  setValue({ ...value, differentFirst: e.target.checked })
                }
              />
              Different first page
            </label>
            {!section && (
              <label>
                <input
                  type="checkbox"
                  checked={!!resolved.differentEven}
                  onChange={(e) =>
                    setValue({ ...value, differentEven: e.target.checked })
                  }
                />
                Different odd and even pages
              </label>
            )}
          </div>
          <div className="story-options">
            <select
              aria-label="Header or footer"
              value={part}
              onChange={(e) => setPart(e.target.value as StoryPart)}
            >
              <option value="header">Header</option>
              <option value="footer">Footer</option>
            </select>
            <select
              aria-label="Header/footer page variant"
              value={variant}
              onChange={(e) => setVariant(e.target.value as StoryVariant)}
            >
              <option value="default">
                {resolved.differentEven ? "Odd pages" : "All pages"}
              </option>
              <option value="first" disabled={!resolved.differentFirst}>
                First page
              </option>
              <option value="even" disabled={!resolved.differentEven}>
                Even pages
              </option>
            </select>
            <label>
              Distance from edge (mm)
              <input
                type="number"
                aria-label="Header/footer distance"
                min={0}
                max={100}
                step="any"
                required
                value={
                  resolved[
                    part === "header" ? "headerDistanceMm" : "footerDistanceMm"
                  ] ?? 10
                }
                onChange={(e) =>
                  setValue({
                    ...value,
                    [part + "DistanceMm"]: Number(e.target.value),
                  })
                }
              />
            </label>
            {section && (
              <label>
                <input
                  type="checkbox"
                  checked={linked}
                  onChange={(e) => {
                    if (e.target.checked) {
                      const next = { ...value[part] };
                      delete next[variant];
                      setValue({ ...value, [part]: next });
                    } else
                      updateStory(
                        structuredClone(
                          resolved[part]?.[variant] || emptyStory(),
                        ),
                      );
                  }}
                />
                Link to previous
              </label>
            )}
          </div>
          {linked ? (
            <p>This {part} uses the previous section’s content.</p>
          ) : (
            <StoryEditor
              assets={project.assets}
              projectId={project.id}
              onCollect={onCollect}
              language={project.language}
              key={`${part}:${variant}:${editorVersion}`}
              document={resolved[part]?.[variant] || emptyStory()}
              onChange={updateStory}
              styles={project.styles}
              fontFamily={project.settings.fontFamily || "Cambria"}
              fields={runningFieldValues(project)}
              label={`${part === "header" ? "Header" : "Footer"} text editor`}
            />
          )}
          <small>
            Running text stays outside body word counts, proofreading and
            narration. Keep it within the page margins.
          </small>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button
            type="button"
            onClick={() => {
              updateStory(null);
              setEditorVersion((v) => v + 1);
            }}
          >
            Clear {part}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="accent"
            disabled={!validRunningMatter(value, section)}
          >
            Apply
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

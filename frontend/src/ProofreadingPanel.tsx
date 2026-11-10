import { formatInteger } from "./numberDisplay";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Annotation, Project } from "./types";
import type { EditorHandle } from "./Editor";
import type { useProofreading } from "./useProofreading";
import BookProofreading from "./BookProofreading";
import ProofreadingVocabulary from "./ProofreadingVocabulary";
import "./proofreading.css";
import { sentenceRange } from "./sentenceRevisions";
import RevisionComparison from "./RevisionComparison";

export type ProofreadingPanelProps = {
  mode?: "selected" | "report" | "hover";
  issueId?: string;
  onNavigate?: () => void;
  controller: ReturnType<typeof useProofreading>;
  project: Project;
  change: (fn: (project: Project) => void) => void;
  editor: () => EditorHandle | null;
  flush: () => Promise<void>;
  onChapter: (id: string, start?: number, end?: number) => void;
};

export default function ProofreadingPanel({
  mode = "selected",
  issueId,
  onNavigate,
  controller: c,
  project,
  change,
  editor,
  flush,
  onChapter,
}: ProofreadingPanelProps) {
  const [actionError, setActionError] = useState("");
  const [category, setCategory] = useState("all");
  const [position, setPosition] = useState(-1);
  const [caretIssue, setCaretIssue] = useState<string>();
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => setRevisionDrafts({}), [c.result?.sourceText, project.id]);
  const improve = () => {
    const current = editor();
    const range = current?.getSelectionOffsets();
    if (!range || !current) return;
    const target =
      range.start === range.end
        ? sentenceRange(current.getText(), range.start)
        : range;
    c.improve(target.start, target.end);
  };
  useEffect(() => {
    if (mode !== "selected") return;
    const update = () => {
      const range = editor()?.getSelectionOffsets();
      const issue =
        range &&
        c.result?.annotations
          .filter((a) => a.start <= range.start && a.end >= range.end)
          .sort(
            (a, b) =>
              Number(b.kind === "sentence-revision") -
                Number(a.kind === "sentence-revision") ||
              a.end - a.start - (b.end - b.start),
          )[0];
      setCaretIssue(issue?.id);
    };
    update();
    window.addEventListener("alder-proofreading-caret", update);
    return () => window.removeEventListener("alder-proofreading-caret", update);
  }, [c.result, editor, mode]);
  const items = (c.result?.annotations || []).filter((a) =>
    mode === "report"
      ? category === "all" || a.type === category
      : a.id === (mode === "hover" ? issueId : caretIssue),
  );
  const navigate = (direction: number) => {
    if (!items.length) return;
    const next = (position + direction + items.length) % items.length;
    setPosition(next);
    editor()?.selectRange(items[next].start, items[next].end);
    document
      .querySelector(
        `.proofreading-window [data-review-id="${items[next].id}"]`,
      )
      ?.scrollIntoView({ block: "nearest" });
  };
  const addWord = async (a: Annotation, personal: boolean) => {
    if (!a.originalText) return;
    setActionError("");
    try {
      if (personal) {
        const previous = await api<{ words: string[] }>(
          "/api/proofreading/dictionary",
        );
        await api("/api/proofreading/dictionary", "PUT", {
          words: [...new Set([...previous.words, a.originalText])],
        });
      } else
        change((p) => {
          if (
            !p.dictionary.some(
              (entry) =>
                entry.word.toLowerCase() === a.originalText!.toLowerCase(),
            )
          )
            p.dictionary.push({
              word: a.originalText!,
              definition: "",
              preferred: null,
            });
        });
      c.recheck();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };
  return (
    <section
      className="proofreading-panel"
      aria-label="Spelling and grammar review"
    >
      {mode === "report" && (
        <>
          <label>
            Sentence revision style
            <select
              aria-label="Sentence revision style"
              value={String(
                project.settings.sentenceRevisionProfile || "standard",
              )}
              onChange={(e) =>
                change((p) => {
                  p.settings.sentenceRevisionProfile = e.target.value;
                })
              }
            >
              <option value="standard">Standard prose</option>
              <option value="creative">Creative writing and dialogue</option>
            </select>
          </label>
          <label>
            English conventions{" "}
            <select
              aria-label="Proofreading dialect"
              value={
                project.settings.proofreadingDialect ||
                (["en-AU", "en-GB", "en-US"].includes(project.language)
                  ? project.language
                  : "en-GB")
              }
              onChange={(e) =>
                change((p) => {
                  p.settings.proofreadingDialect = e.target.value;
                })
              }
            >
              <option value="en-AU">Australian</option>
              <option value="en-GB">British</option>
              <option value="en-US">US</option>
            </select>
          </label>
          <p className="muted">
            Paragraph and style languages determine which local rules are used.
            Unsupported languages are reported as unchecked.
          </p>
          <label>
            <input
              type="checkbox"
              checked={project.settings.proofreadingStyle === true}
              onChange={(e) =>
                change((p) => {
                  p.settings.proofreadingStyle = e.target.checked;
                })
              }
            />{" "}
            Include optional style advice
          </label>
          <div className="proofreading-actions">
            <button
              disabled={!c.capabilities?.engines.model.available}
              onClick={improve}
              title="Improve the current sentence or selected text (F7)"
            >
              Improve sentence or selection
            </button>
            <button onClick={c.fastOnly}>Check spelling and grammar</button>
            <button
              onClick={() => {
                const range = editor()?.getSelectionOffsets();
                if (!range || range.start === range.end)
                  setActionError("Select a passage in the editor first.");
                else {
                  setActionError("");
                  c.checkSelection(range.start, range.end);
                }
              }}
            >
              Check selected text
            </button>
            <button
              onClick={c.reviewAdvanced}
              disabled={!c.capabilities?.engines.model.available}
            >
              Advanced review
            </button>
            <button
              onClick={c.cancel}
              disabled={
                !c.revisionBusy &&
                (!c.result || !["queued", "running"].includes(c.result.status))
              }
            >
              Cancel
            </button>
          </div>
          <p role="status" aria-live="polite">
            {c.status}
          </p>
          <p role="status">{c.revisionStatus}</p>
          <label>
            <input
              type="checkbox"
              checked={project.settings.sentenceRevisions !== false}
              onChange={(e) =>
                change((p) => {
                  p.settings.sentenceRevisions = e.target.checked;
                })
              }
            />
            Suggest sentence structure and clarity improvements
          </label>
          {c.result && (
            <p>
              {formatInteger(c.result.annotations.length)} issues ·{" "}
              {formatInteger(c.result.words)} words ·{" "}
              {formatInteger(c.result.sentences)} sentences
            </p>
          )}
          <p>Scope: {c.scope}.</p>
          {c.advanced && (
            <p>
              Advanced suggestions use an experimental local model. Review the
              proposed changes.
            </p>
          )}
          {!c.capabilities?.engines.model.available && (
            <p>{c.capabilities?.engines.model.reason}</p>
          )}
          {c.result?.warnings.map((warning) => (
            <p role="alert" key={warning}>
              {warning}
            </p>
          ))}
          {actionError && <p role="alert">{actionError}</p>}
          {c.result && (
            <p>
              {formatInteger(c.result.coverage.checkedBlocks)} of{" "}
              {formatInteger(c.result.coverage.totalBlocks)} passages checked
              {c.advanced
                ? `; ${formatInteger(c.result.coverage.advancedBlocks)} reviewed with the model`
                : ""}
              .
            </p>
          )}
          <label>
            Show{" "}
            <select
              aria-label="Proofreading category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {[
                "all",
                "spelling",
                "grammar",
                "clarity",
                "punctuation",
                "style",
                "terminology",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <div className="proofreading-actions">
            <button disabled={!items.length} onClick={() => navigate(-1)}>
              Previous issue
            </button>
            <button disabled={!items.length} onClick={() => navigate(1)}>
              Next issue
            </button>
          </div>
        </>
      )}
      {mode !== "report" && actionError && <p role="alert">{actionError}</p>}
      {items.map((a) => (
        <div
          className="check-item"
          key={a.id}
          data-review-id={a.id}
          data-review-engine={a.engine}
        >
          <button
            onClick={() => {
              onNavigate?.();
              editor()?.selectRange(a.start, a.end);
            }}
          >
            <span className="check-type">{a.type}</span>
            {a.message}
          </button>
          {a.engine === "model" && <small>Possible issue · local model</small>}
          {a.kind === "sentence-revision" && (
            <div className="sentence-revision-preview">
              <p>
                <strong>Suggested revision</strong>
              </p>
              <p>{revisionDrafts[a.id] ?? a.replacementText}</p>
              <details>
                <summary>Compare original</summary>
                <p>{a.originalText}</p>
              </details>
              <details>
                <summary>Show changes</summary>
                <RevisionComparison
                  original={a.originalText || ""}
                  revised={revisionDrafts[a.id] ?? a.replacementText ?? ""}
                />
              </details>
              <details>
                <summary>Edit revision</summary>
                <textarea
                  aria-label="Edit proposed sentence revision"
                  value={revisionDrafts[a.id] ?? a.replacementText ?? ""}
                  onChange={(event) =>
                    setRevisionDrafts((previous) => ({
                      ...previous,
                      [a.id]: event.target.value,
                    }))
                  }
                />
              </details>
              <button
                onClick={() => {
                  setRevisionDrafts((previous) => {
                    const next = { ...previous };
                    delete next[a.id];
                    return next;
                  });
                  c.rephrase(a.start, a.end);
                }}
              >
                Another version
              </button>
            </div>
          )}
          {(a.alternatives || []).map((alternative, index) => (
            <button
              className="suggestion-button"
              key={index}
              onClick={() => {
                const current = editor();
                if (!current || !c.result) return;
                try {
                  current.applyProofreading(
                    a.kind === "sentence-revision" &&
                      revisionDrafts[a.id] !== undefined
                      ? alternative.edits.map((edit) => ({
                          ...edit,
                          replacement: revisionDrafts[a.id],
                        }))
                      : alternative.edits,
                    c.result.sourceText,
                    a.kind === "sentence-revision",
                  );
                  setActionError("");
                } catch (e) {
                  setActionError((e as Error).message);
                }
              }}
            >
              {a.kind === "sentence-revision"
                ? "Accept rewrite"
                : alternative.edits.length > 1
                  ? "Apply linked corrections"
                  : alternative.edits[0]?.replacement === ""
                    ? "Delete repeated or unnecessary text"
                    : `Use “${alternative.edits[0]?.replacement}”`}
            </button>
          ))}
          {a.alternatives?.some(
            (alternative) => alternative.edits.length > 1,
          ) && (
            <ul>
              {a.alternatives[0].edits.map((edit, index) => (
                <li key={index}>
                  {edit.originalText || "(insert)"} →{" "}
                  {edit.replacement || "(delete)"}
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => c.ignore(a.id)}>Ignore once</button>
          {a.ruleId && (
            <button
              onClick={() =>
                change((p) => {
                  p.settings.ignoredRuleIds = [
                    ...new Set([
                      ...(p.settings.ignoredRuleIds || []),
                      a.ruleId!,
                    ]),
                  ];
                })
              }
            >
              Ignore rule in project
            </button>
          )}
          {a.type === "spelling" && (
            <>
              <button onClick={() => void addWord(a, false)}>
                Accept in project
              </button>
              <button onClick={() => void addWord(a, true)}>
                Add to personal dictionary
              </button>
            </>
          )}
        </div>
      ))}
      {mode === "selected" && !items.length && (
        <p>Place the text cursor on an underlined issue to review it.</p>
      )}
      {mode === "selected" && (
        <>
          <button
            onClick={improve}
            disabled={!c.capabilities?.engines.model.available}
          >
            Improve sentence or selection
          </button>
          <p role="status">{c.revisionStatus}</p>
        </>
      )}
      {mode === "report" && (
        <>
          {!items.length && c.result?.status === "completed" && (
            <p>
              {category === "all"
                ? "No spelling or grammar rule issues found."
                : "No suggestions in this category."}
            </p>
          )}
          <BookProofreading
            project={project}
            flush={flush}
            onChapter={onChapter}
            advanced={c.advanced}
            sentenceModelAvailable={
              c.capabilities?.engines.model.available === true
            }
            currentTarget={
              c.scope === "Selected text" ? undefined : c.result?.targetId
            }
          />
          <ProofreadingVocabulary
            project={project}
            change={change}
            recheck={c.recheck}
          />
        </>
      )}
    </section>
  );
}

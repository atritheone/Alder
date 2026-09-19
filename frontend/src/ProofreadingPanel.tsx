import { useState } from "react";
import { api } from "./api";
import type { Annotation, Project } from "./types";
import type { EditorHandle } from "./Editor";
import type { useProofreading } from "./useProofreading";
import BookProofreading from "./BookProofreading";
import ProofreadingVocabulary from "./ProofreadingVocabulary";
import "./proofreading.css";

type Props = {
  controller: ReturnType<typeof useProofreading>;
  project: Project;
  change: (fn: (project: Project) => void) => void;
  editor: () => EditorHandle | null;
  flush: () => Promise<void>;
  onChapter: (id: string) => void;
};

export default function ProofreadingPanel({
  controller: c,
  project,
  change,
  editor,
  flush,
  onChapter,
}: Props) {
  const [actionError, setActionError] = useState("");
  const [category, setCategory] = useState("all");
  const [position, setPosition] = useState(-1);
  const items = (c.result?.annotations || []).filter(
    (a) => category === "all" || a.type === category,
  );
  const navigate = (direction: number) => {
    if (!items.length) return;
    const next = (position + direction + items.length) % items.length;
    setPosition(next);
    editor()?.selectRange(items[next].start, items[next].end);
    document
      .querySelector(`[data-review-id="${items[next].id}"]`)
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
      <label>
        English conventions{" "}
        <select
          aria-label="Proofreading dialect"
          value={
            project.settings.proofreadingDialect ||
            (project.language === "en" ? "en-GB" : project.language)
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
            !c.result || !["queued", "running"].includes(c.result.status)
          }
        >
          Cancel
        </button>
      </div>
      <p role="status" aria-live="polite">
        {c.status}
      </p>
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
          {c.result.coverage.checkedBlocks} of {c.result.coverage.totalBlocks}{" "}
          passages checked
          {c.advanced
            ? `; ${c.result.coverage.advancedBlocks} reviewed with the model`
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
      {items.map((a) => (
        <div
          className="check-item"
          key={a.id}
          data-review-id={a.id}
          data-review-engine={a.engine}
        >
          <button onClick={() => editor()?.selectRange(a.start, a.end)}>
            <span className="check-type">{a.type}</span>
            {a.message}
          </button>
          {a.engine === "model" && <small>Possible issue · local model</small>}
          {(a.alternatives || []).map((alternative, index) => (
            <button
              className="suggestion-button"
              key={index}
              onClick={() => {
                const current = editor();
                if (!current || !c.result) return;
                try {
                  current.applyProofreading(
                    alternative.edits,
                    c.result.sourceText,
                  );
                  setActionError("");
                } catch (e) {
                  setActionError((e as Error).message);
                }
              }}
            >
              {alternative.edits.length > 1
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
      {!items.length && c.result?.status === "completed" && (
        <p>No issues found in the checked text.</p>
      )}
      <BookProofreading
        project={project}
        flush={flush}
        onChapter={onChapter}
        advanced={c.advanced}
      />
      <ProofreadingVocabulary
        project={project}
        change={change}
        recheck={c.recheck}
      />
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Annotation, Project } from "./types";
import type { ProofreadingResult } from "./useProofreading";

/** Scan chapter snapshots sequentially; open a chapter for source-validated edits. */
export default function BookProofreading({
  project,
  flush,
  onChapter,
  advanced,
  currentTarget,
}: {
  project: Project;
  flush: () => Promise<void>;
  onChapter: (id: string, start?: number, end?: number) => void;
  advanced: boolean;
  currentTarget?: string;
}) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<
    {
      id: string;
      title: string;
      text: string;
      annotations: Annotation[];
      warnings: string[];
      status: string;
      configuration: string;
    }[]
  >([]);
  const run = useRef<{ cancelled: boolean; job?: string } | null>(null);
  const current = useRef(project);
  current.current = project;
  const configuration = (p: Project) =>
    JSON.stringify([
      p.language,
      p.settings.proofreadingDialect,
      p.settings.proofreadingStyle,
      p.settings.ignoredRuleIds,
      p.settings.ignoredRules,
      p.settings.customRules,
      p.dictionary,
    ]);
  const stop = () => {
    if (run.current) {
      run.current.cancelled = true;
      if (run.current.job)
        void api(`/api/proofreading/jobs/${run.current.job}`, "DELETE").catch(
          () => {},
        );
    }
  };
  useEffect(() => {
    run.current = null;
    setRunning(false);
    setResults([]);
    setMessage("");
    return stop;
  }, [project.id]);
  const check = async () => {
    if (running) return;
    const token = { cancelled: false, job: "" };
    run.current = token;
    setRunning(true);
    setResults([]);
    try {
      await flush();
      const snapshot = current.current;
      const identity = configuration(snapshot);
      const chapters = [...(snapshot.book?.chapters || [])];
      for (let index = 0; index < chapters.length; index++) {
        if (token.cancelled) break;
        const chapter = chapters[index];
        setMessage(`Checking chapter ${index + 1} of ${chapters.length}…`);
        let job = await api<ProofreadingResult>(
          "/api/proofreading/check",
          "POST",
          {
            text: chapter.text,
            projectId: snapshot.id,
            targetId: `${snapshot.id}:book-review:${chapter.id}`,
            advanced,
          },
        );
        token.job = job.id;
        while (!token.cancelled && ["queued", "running"].includes(job.status)) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (!token.cancelled)
            job = await api<ProofreadingResult>(
              `/api/proofreading/jobs/${job.id}`,
            );
        }
        if (token.cancelled) {
          await api(`/api/proofreading/jobs/${job.id}`, "DELETE");
          break;
        }
        setResults((items) => [
          ...items,
          {
            id: chapter.id,
            title: chapter.title || `Chapter ${index + 1}`,
            text: chapter.text,
            annotations: job.annotations,
            warnings: job.warnings,
            status: job.status,
            configuration: identity,
          },
        ]);
      }
      if (run.current === token)
        setMessage(
          token.cancelled
            ? "Book review cancelled."
            : "Book review finished. Open a chapter to review its current suggestions.",
        );
    } catch (error) {
      if (!token.cancelled)
        setMessage(`Book review incomplete: ${(error as Error).message}`);
    } finally {
      if (run.current === token) {
        setRunning(false);
        run.current = null;
      }
    }
  };
  useEffect(() => {
    if ((current.current.book?.chapters.length || 0) > 1) void check();
    return stop;
  }, []);
  if ((project.book?.chapters.length || 0) < 2) return null;
  return (
    <details open>
      <summary>Whole book review</summary>
      <p>
        Scan every chapter with{" "}
        {advanced ? "rules and the local model" : "spelling and grammar rules"}.
        Suggestions are applied only after opening the chapter.
      </p>
      <div className="proofreading-actions">
        <button disabled={running} onClick={() => void check()}>
          Check whole book
        </button>
        <button disabled={!running} onClick={stop}>
          Cancel book review
        </button>
      </div>
      <p role="status">{message}</p>
      <ul className="book-proofreading-results">
        {results.map((result) => {
          const stale =
            result.configuration !== configuration(project) ||
            project.book?.chapters.find((chapter) => chapter.id === result.id)
              ?.text !== result.text;
          return (
            <li key={result.id}>
              <button onClick={() => onChapter(result.id)}>
                {result.title}
              </button>
              {stale
                ? " — changed; recheck required"
                : ` — ${result.annotations.length} issues (${result.status})`}
              {!stale &&
                result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              {!stale &&
                currentTarget === `${project.id}:chapter:${result.id}` && (
                  <p>Issues for this chapter are shown above.</p>
                )}
              {!stale &&
                currentTarget !== `${project.id}:chapter:${result.id}` &&
                result.annotations.map((issue) => (
                  <div className="check-item" key={issue.id}>
                    <button
                      onClick={() =>
                        onChapter(result.id, issue.start, issue.end)
                      }
                    >
                      <span className="check-type">{issue.type}</span>
                      {issue.message}
                    </button>
                    <p>
                      {result.text.slice(
                        Math.max(0, issue.start - 35),
                        issue.start,
                      )}
                      <strong>
                        {result.text.slice(issue.start, issue.end)}
                      </strong>
                      {result.text.slice(issue.end, issue.end + 35)}
                    </p>
                  </div>
                ))}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

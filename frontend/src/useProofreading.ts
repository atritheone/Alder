import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { Analysis, Project, DocNode } from "./types";
import { generatedTextSpans, intersectsTextSpans } from "./textProjection";
import { proofreadingLanguages } from "./proofreadingLanguages";
import { useSentenceRevisions } from "./useSentenceRevisions";

export type ProofreadingResult = Analysis & {
  id: string;
  targetId: string;
  sourceText: string;
  sourceHash: string;
  configurationHash: string;
  localConfiguration: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "partial"
    | "failed"
    | "cancelled";
  stage: string;
  message: string;
  sequence: number;
  warnings: string[];
  truncated: boolean;
  coverage: {
    totalBlocks: number;
    checkedBlocks: number;
    advancedBlocks: number;
    skippedBlocks: number;
  };
};

export function useProofreading(
  text: string | undefined,
  targetId: string,
  project: Project | null,
  flush: () => Promise<void>,
  document?: DocNode,
  language?: string,
) {
  const [result, setResult] = useState<ProofreadingResult | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [revisionRequest, setRevisionRequest] = useState(0);
  const [rephrase, setRephrase] = useState(false);
  const [revisionRange, setRevisionRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [capabilities, setCapabilities] = useState<any>(null);
  const [cancelled, setCancelled] = useState(false);
  const [selection, setSelection] = useState<{
    source: string;
    start: number;
    end: number;
  } | null>(null);
  const active = useRef<string | null>(null);
  const snapshot = useRef({ targetId, text });
  snapshot.current = { targetId, text };
  const selectedRange =
    selection && selection.source === text
      ? JSON.stringify({ start: selection.start, end: selection.end })
      : "null";
  const languages = useMemo(
    () =>
      JSON.stringify(
        project ? proofreadingLanguages(document, project, language, text) : [],
      ),
    [
      document,
      text,
      project?.styles,
      project?.language,
      project?.settings.proofreadingDialect,
      language,
    ],
  );
  const configuration = JSON.stringify({
    revisionProfile: project?.settings.sentenceRevisionProfile || "standard",
    dialect:
      project?.settings.proofreadingDialect ||
      (["en-AU", "en-GB", "en-US"].includes(project?.language || "")
        ? project?.language
        : undefined) ||
      "en-GB",
    style: project?.settings.proofreadingStyle === true,
    acceptedWords: project?.dictionary.map((entry) => entry.word) || [],
    ignoredRuleIds: project?.settings.ignoredRuleIds || [],
  });
  const projectRules = JSON.stringify([
    project?.settings.customRules,
    project?.settings.ignoredRules,
    project?.dictionary,
  ]);
  const revisions = useSentenceRevisions(
    text,
    targetId,
    project?.id,
    configuration,
    languages,
    capabilities?.engines.model.available === true &&
      (project?.settings.sentenceRevisions !== false || revisionRequest > 0),
    revisionRequest + refresh,
    revisionRange,
    rephrase,
    flush,
  );
  useEffect(() => {
    setRevisionRange(null);
    setRevisionRequest(0);
  }, [targetId, text]);
  useEffect(() => {
    api("/api/proofreading/capabilities")
      .then(setCapabilities)
      .catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    setIgnored(new Set());
    setAdvanced(false);
    setSelection(null);
  }, [targetId]);
  useEffect(() => {
    if (text === undefined || !project || !targetId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let jobId: string | null = null;
    setCancelled(false);
    setError("");
    const source = text;
    const target = targetId;
    const publish = (job: ProofreadingResult) => {
      if (
        !disposed &&
        snapshot.current.targetId === target &&
        snapshot.current.text === source
      )
        setResult({
          ...job,
          sourceText: source,
          localConfiguration:
            configuration + projectRules + selectedRange + languages,
        });
    };
    const poll = async () => {
      if (disposed || !jobId) return;
      try {
        const job = await api<ProofreadingResult>(
          `/api/proofreading/jobs/${jobId}`,
        );
        publish(job);
        if (!disposed && ["queued", "running"].includes(job.status))
          timer = setTimeout(poll, 500);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    };
    timer = setTimeout(
      async () => {
        try {
          await flush();
          if (disposed) return;
          const job = await api<ProofreadingResult>(
            "/api/proofreading/check",
            "POST",
            {
              text: source,
              targetId: target,
              projectId: project.id,
              configuration: JSON.parse(configuration),
              advanced,
              range: JSON.parse(selectedRange),
              languageRanges: JSON.parse(languages),
            },
          );
          jobId = job.id;
          if (disposed) {
            void api(`/api/proofreading/jobs/${jobId}`, "DELETE").catch(
              () => {},
            );
            return;
          }
          active.current = jobId;
          publish(job);
          timer = setTimeout(poll, 150);
        } catch (e) {
          if (!disposed) setError((e as Error).message);
        }
      },
      advanced ? 1200 : 350,
    );
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (jobId)
        void api(`/api/proofreading/jobs/${jobId}`, "DELETE").catch(() => {});
    };
  }, [
    text,
    targetId,
    project?.id,
    configuration,
    projectRules,
    selectedRange,
    languages,
    refresh,
    advanced,
    flush,
  ]);
  const current =
    result?.targetId === targetId &&
    result.sourceText === text &&
    result.localConfiguration ===
      configuration + projectRules + selectedRange + languages
      ? result
      : null;
  const generated = useMemo(
    () => (document ? generatedTextSpans(document) : []),
    [document],
  );
  const visible = useMemo(
    () =>
      current
        ? {
            ...current,
            annotations: current.annotations.filter(
              (a) =>
                !ignored.has(a.id) &&
                !intersectsTextSpans(generated, a.start, a.end),
            ),
          }
        : null,
    [current, ignored, generated],
  );
  // Retained sentence revisions are independently source/context validated.
  // A pending rules request must not hide them while the author types elsewhere.
  const display =
    visible ??
    (text !== undefined &&
    result?.targetId === targetId &&
    revisions.annotations.length
      ? {
          ...result,
          sourceText: text,
          sourceHash: "",
          configurationHash: "",
          status: "running" as const,
          message: "Checking current text…",
          warnings: [],
          annotations: [],
        }
      : null);
  return {
    result: display
      ? {
          ...display,
          annotations: [
            ...display.annotations,
            ...revisions.annotations.filter(
              (a) =>
                !ignored.has(a.id) &&
                (a.preservesGenerated ||
                  !intersectsTextSpans(generated, a.start, a.end)),
            ),
          ],
        }
      : display,
    revisionStatus: revisions.status,
    revisionBusy: revisions.busy,
    improve: (start: number, end: number) => {
      setRephrase(false);
      setRevisionRange({ start, end });
      setRevisionRequest((v) => v + 1);
    },
    rephrase: (start: number, end: number) => {
      setRephrase(true);
      setRevisionRange({ start, end });
      setRevisionRequest((v) => v + 1);
    },
    error,
    capabilities,
    advanced,
    scope:
      selectedRange === "null" ? "Current chapter or draft" : "Selected text",
    status:
      error ||
      (cancelled
        ? "Check cancelled."
        : current?.message || "Waiting to check this text…"),
    recheck: () => {
      setIgnored(new Set());
      setRefresh((value) => value + 1);
    },
    reviewAdvanced: () => {
      setAdvanced(true);
      setRefresh((value) => value + 1);
    },
    wholeText: () => setSelection(null),
    fastOnly: () => {
      revisions.cancel();
      setSelection(null);
      setAdvanced(false);
      setRefresh((value) => value + 1);
    },
    checkSelection: (start: number, end: number) => {
      if (text && end > start) {
        setSelection({ source: text, start, end });
        setRefresh((value) => value + 1);
      }
    },
    cancel: () => {
      revisions.cancel();
      setCancelled(true);
      if (active.current)
        void api(`/api/proofreading/jobs/${active.current}`, "DELETE").catch(
          (e) => setError(e.message),
        );
    },
    ignore: (id: string) =>
      setIgnored((previous) => new Set([...previous, id])),
  };
}

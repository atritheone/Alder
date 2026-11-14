import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Annotation } from "./types";
import { rebaseRevisions } from "./sentenceRevisions";

type Result = {
  id: string;
  status: string;
  annotations: Annotation[];
  warnings: string[];
  message: string;
};
export function useSentenceRevisions(
  text: string | undefined,
  targetId: string,
  projectId: string | undefined,
  configuration: string,
  languages: string,
  enabled: boolean,
  request: number,
  range: { start: number; end: number } | null,
  rephrase: boolean,
  flush: () => Promise<void>,
  projectContext?: unknown,
) {
  const submitted = useRef({ targetId: "", text: "" });
  const stop = useRef<() => void>(() => {});
  const [state, setState] = useState({
    text: "",
    targetId: "",
    configuration: "",
    languages: "[]",
    annotations: [] as Annotation[],
    status: "",
    busy: false,
  });
  useEffect(() => {
    if (text === undefined || !projectId || !enabled) return;
    let disposed = false;
    const controller = new AbortController();
    let job: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<Result>(`/api/proofreading/jobs/${job}`, "GET", undefined, controller.signal);
        if (disposed) return;
        setState((previous) => {
          const retained =
            (range !== null || ["running", "queued"].includes(result.status)) &&
            previous.targetId === targetId &&
            previous.configuration === configuration
              ? rebaseRevisions(
                  previous.annotations,
                  previous.text,
                  text,
                  previous.languages,
                  languages,
                ).filter(
                  (a) => !range || a.end <= range.start || a.start >= range.end,
                )
              : [];
          const byRange = new Map(
            retained.map((a) => [`${a.start}:${a.end}`, a]),
          );
          result.annotations.forEach((a) =>
            byRange.set(`${a.start}:${a.end}`, a),
          );
          return {
            text,
            targetId,
            configuration,
            languages,
            annotations: [...byRange.values()],
            status: result.warnings.join(" ") || result.message,
            busy: ["running", "queued"].includes(result.status),
          };
        });
        if (["running", "queued"].includes(result.status))
          timer = setTimeout(poll, 250);
      } catch (error) {
        if (!disposed)
          setState((s) => ({
            ...s,
            busy: false,
            status: (error as Error).message,
          }));
      }
    };
    timer = setTimeout(
      async () => {
        try {
          if (disposed) return;
          setState((s) => ({
            ...s,
            busy: true,
            status: "Reviewing sentence structure…",
          }));
          let focus = 0;
          if (submitted.current.targetId === targetId) {
            const previous = submitted.current.text;
            while (
              focus < previous.length &&
              focus < text.length &&
              previous[focus] === text[focus]
            )
              focus++;
            if (focus > 0 && /[\uDC00-\uDFFF]/.test(text[focus] || "")) focus--;
          }
          submitted.current = { targetId, text };
          const result = await api<Result>("/api/proofreading/check", "POST", {
            text,
            targetId: `${targetId}:revision`,
            projectId,
            projectContext,
            revision: true,
            focus: range?.start ?? focus,
            revisionMode: rephrase ? "rephrase" : "improve",
            revisionAttempt: rephrase ? request : 0,
            configuration: JSON.parse(configuration),
            languageRanges: JSON.parse(languages),
            range,
          });
          job = result.id;
          if (disposed) {
            void api(`/api/proofreading/jobs/${job}`, "DELETE").catch(() => {});
            return;
          }
          await poll();
        } catch (error) {
          if (!disposed)
            setState((s) => ({
              ...s,
              busy: false,
              status: (error as Error).message,
            }));
        }
      },
      request ? 150 : 1200,
    );
    const cancel = () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      if (job)
        void api(`/api/proofreading/jobs/${job}`, "DELETE").catch(() => {});
    };
    stop.current = cancel;
    return cancel;
  }, [
    text,
    targetId,
    projectId,
    configuration,
    languages,
    enabled,
    request,
    range,
    rephrase,
    flush,
    projectContext,
  ]);
  const valid =
    enabled &&
    state.targetId === targetId &&
    state.configuration === configuration;
  return {
    annotations: valid
      ? rebaseRevisions(
          state.annotations,
          state.text,
          text || "",
          state.languages,
          languages,
        )
      : [],
    status: enabled ? state.status : "",
    busy: enabled && state.busy,
    cancel: () => {
      stop.current();
      setState((s) => ({
        ...s,
        busy: false,
        status: "Sentence review cancelled.",
      }));
    },
  };
}

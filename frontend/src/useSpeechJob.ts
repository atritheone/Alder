import { useEffect, type Dispatch, type SetStateAction } from "react";
import { api } from "./api";
import type { Job } from "./types";

type EventBatch = {
  sequence: number;
  snapshot?: Job;
  reset?: boolean;
  events?: {
    sequence: number;
    header: Partial<Job>;
    order?: string[];
    chunks: Job["chunks"];
  }[];
};
export function mergeSpeechEvents(job: Job, batch: EventBatch): Job {
  if (batch.snapshot)
    return batch.reset ||
      (batch.snapshot.eventSequence || 0) >= (job.eventSequence || 0)
      ? batch.snapshot
      : job;
  let next = job;
  for (const event of batch.events || []) {
    if (event.sequence <= (next.eventSequence || 0)) continue;
    const chunks = new Map(next.chunks.map((c) => [c.id, c]));
    for (const chunk of event.chunks)
      chunks.set(chunk.id, {
        ...chunks.get(chunk.id),
        ...chunk,
        audioUrl: chunk.playbackEligible ? chunk.audioUrl : undefined,
      });
    next = {
      ...next,
      ...event.header,
      eventSequence: event.sequence,
      chunks: (event.order || next.chunks.map((c) => c.id))
        .map((id) => chunks.get(id)!)
        .filter(Boolean),
    };
  }
  return next;
}

/** One outstanding long poll: updates arrive immediately, with bounded reconnect. */
export function useSpeechJob(
  job: Job | null,
  setJob: Dispatch<SetStateAction<Job | null>>,
) {
  useEffect(() => {
    if (!job) return;
    let live = true;
    let sequence = job.eventSequence || 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const receive = async () => {
      while (live) {
        try {
          const batch = await api<EventBatch>(
            `/api/speech/jobs/${job.id}/events?after=${sequence}&wait=20`,
          );
          if (!live) return;
          sequence = batch.sequence;
          setJob((previous) =>
            previous?.id === job.id
              ? mergeSpeechEvents(previous, batch)
              : previous,
          );
        } catch {
          if (!live) return;
          try {
            const snapshot = await api<Job>(`/api/speech/jobs/${job.id}`);
            if (!live) return;
            sequence = snapshot.eventSequence || 0;
            setJob((previous) =>
              previous?.id === job.id
                ? mergeSpeechEvents(previous, {
                    sequence: snapshot.eventSequence || 0,
                    snapshot,
                  })
                : previous,
            );
          } catch {
            /* A transient connection loss must not discard retained audio. */
          }
          if (live) retry = setTimeout(() => void receive(), 1500);
          return;
        }
      }
    };
    void receive();
    return () => {
      live = false;
      clearTimeout(retry);
    };
  }, [job?.id, setJob]);
}

export function useSpeechDemand(
  jobId: string | undefined,
  index: number,
  speed: number,
  mode: "playing" | "paused" | "stopped",
) {
  useEffect(() => {
    if (!jobId) return;
    const send = () =>
      void api(`/api/speech/jobs/${jobId}/demand`, "POST", {
        index,
        speed,
        mode,
      }).catch(() => {});
    send();
    if (mode === "stopped") return;
    const timer = setInterval(send, 5000);
    return () => clearInterval(timer);
  }, [jobId, index, speed, mode]);
}

export function codePointOffsets(text: string): number[] {
  const offsets = [0];
  for (const character of text)
    offsets.push(offsets[offsets.length - 1] + character.length);
  return offsets;
}

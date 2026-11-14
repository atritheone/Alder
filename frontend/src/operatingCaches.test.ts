import { it, expect } from "vitest";
import { chapterStats } from "./chapterStats";
import { mergeSpeechEvents } from "./useSpeechJob";
import type { Chapter, Job } from "./types";
it("reuses unchanged chapter analysis and invalidates changed text", () => {
  const chapter={text:'One sentence. Two words.'} as Chapter;
  const first=chapterStats(chapter,true);
  expect(chapterStats(chapter,true)).toBe(first);
  expect(first.index).toHaveLength(4);
  chapter.text='Changed.';
  expect(chapterStats(chapter).words).toBe(1);
});
it("folds ordered narration deltas without losing prior chunk changes or stale-event guards", () => {
  const job={eventSequence:1,chunks:[{id:'a',text:'A'},{id:'b',text:'B'}]} as Job;
  const next=mergeSpeechEvents(job,{sequence:3,events:[
    {sequence:2,header:{progress:20},chunks:[{...job.chunks[0],playbackEligible:true,audioUrl:'audio'}]},
    {sequence:3,header:{progress:30},order:['b','a'],chunks:[{...job.chunks[1],playbackEligible:false,audioUrl:'unsafe'}]},
  ]});
  expect(next.chunks.map(c=>c.id)).toEqual(['b','a']);
  expect(next.chunks[0].audioUrl).toBeUndefined();
  expect(next.chunks[1].audioUrl).toBe('audio');
  expect(job.chunks[0].audioUrl).toBeUndefined();
  expect(mergeSpeechEvents(next,{sequence:3,events:[]})).toBe(next);
});

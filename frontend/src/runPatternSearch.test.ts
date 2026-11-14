import { afterEach, expect, it, vi } from "vitest";
import { runPatternSearch } from "./runPatternSearch";
import type { PatternRequest } from "./patternSearch";
class FakeWorker {
  static made: FakeWorker[]=[];
  onmessage: ((event:any)=>void)|null=null; onerror: (()=>void)|null=null;
  terminated=false;
  constructor(){FakeWorker.made.push(this);}
  postMessage(){} terminate(){this.terminated=true;}
}
afterEach(()=>{vi.runAllTimers();vi.useRealTimers();vi.unstubAllGlobals();FakeWorker.made=[];});
it("reuses completed search workers but destroys cancelled workers and expires idle workers", async()=>{
  vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);
  const first=runPatternSearch({} as PatternRequest,new AbortController().signal);
  FakeWorker.made[0].onmessage!({data:{matches:[]}});await first;
  const abort=new AbortController();const next=runPatternSearch({} as PatternRequest,abort.signal);
  expect(FakeWorker.made).toHaveLength(1);
  const rejected=expect(next).rejects.toMatchObject({name:'AbortError'});abort.abort();await rejected;
  expect(FakeWorker.made[0].terminated).toBe(true);
  const third=runPatternSearch({} as PatternRequest,new AbortController().signal);
  expect(FakeWorker.made).toHaveLength(2);
  FakeWorker.made[1].onmessage!({data:{matches:[]}});await third;
  vi.advanceTimersByTime(30000);expect(FakeWorker.made[1].terminated).toBe(true);
});

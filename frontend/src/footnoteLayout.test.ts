import { describe, it, expect } from "vitest";
import { allocateFootnotes } from "./footnoteLayout";
const layout = {
  width: 400,
  height: 300,
  margin: 30,
  lineHeight: 1.5,
  zoom: 1,
};
const pages = [
  { from: 0, to: 50, text: "" },
  { from: 50, to: 100, text: "" },
];
const note = (id: string, pos: number, count: number) => ({
  id,
  pos,
  lines: Array.from({ length: count }, (_, i) => ({
    html: `${id}:${i}`,
    height: 20,
  })),
});
describe("flowing footnote reservations", () => {
  it('does not repeat a note number when its first page contained only the label',()=>{
    const result=allocateFootnotes([{id:'label',pos:10,width:340,maximum:178,lines:[{html:'1',height:178,sourceFrom:0},{html:'body',height:20,sourceFrom:0}],measure:(width,maximum,from,continued)=>{
      expect(from).toBe(0);expect(continued).toBe(true);return [{html:'body',height:20,sourceFrom:0}];
    }}],[pages[0],{...pages[1],frame:{top:328,left:0,layout:{...layout,width:280}}}],layout);
    expect(result.fragments.flat().flatMap(f=>f.lines.map(l=>l.html))).toEqual(['1','body']);
  });
  it('remeasures a continuation from its unread offset when the text width changes',()=>{
    const changes:{width:number;from:number}[]=[];
    const lines=Array.from({length:12},(_,i)=>({html:String(i),height:20,sourceFrom:i}));
    const result=allocateFootnotes([{id:'note',pos:10,lines,width:340,maximum:178,measure:(width,maximum,from)=>{
      changes.push({width,from});return lines.slice(from).map(l=>({...l,height:30}));
    }}],[pages[0],{...pages[1],frame:{top:328,left:0,layout:{...layout,width:280}}}],layout);
    expect(changes).toEqual([{width:220,from:8}]);
    expect(result.fragments.flat().flatMap(f=>f.lines.map(l=>l.html))).toEqual(lines.map(l=>l.html));
    expect(result.fragments[1][0].continued).toBe(true);
  });
  it("carries long notes before later anchors and keeps every line exactly once", () => {
    const result = allocateFootnotes(
      [note("one", 10, 20), note("two", 60, 5)],
      pages,
      layout,
    );
    expect(
      result.fragments.flat().flatMap((p) => p.lines.map((l) => l.html)),
    ).toEqual(
      [...note("one", 10, 20).lines, ...note("two", 60, 5).lines].map(
        (l) => l.html,
      ),
    );
    expect(result.fragments[1][0].continued).toBe(true);
    expect(result.minimums).toEqual([{ pos: 60, page: 2 }]);
    expect(result.reserves.every((height) => height <= 192)).toBe(true);
  });
  it("keeps an anchor on its new page after releasing its former reserve", () => {
    const floor = new Map([[40, 1]]);
    const result = allocateFootnotes(
      [note("one", 40, 2)],
      pages,
      layout,
      floor,
    );
    expect(result.fragments[0]).toBeUndefined();
    expect(result.fragments[1][0].id).toBe("one");
  });
  it("rejects impossible line geometry instead of clipping or looping", () => {
    expect(() =>
      allocateFootnotes(
        [{ id: "tall", pos: 10, lines: [{ html: "Text", height: 400 }] }],
        pages,
        layout,
      ),
    ).toThrow("taller");
  });
  it("reserves repeated note-table headings on continuations and keeps the original heading with its row", () => {
    const heading = { html: "Repeated heading", height: 20 };
    const lines = [
      { html: "Original heading", height: 20, keepWithNext: true },
      ...Array.from({ length: 19 }, (_, i) => ({
        html: `Row ${i}`,
        height: 20,
        repeat: [heading],
      })),
    ];
    const result = allocateFootnotes(
      [{ id: "table", pos: 10, lines }],
      pages,
      layout,
    );
    expect(result.fragments[1][0].lines[0]).toEqual(heading);
    expect(
      result.fragments
        .flat()
        .flatMap((fragment) =>
          fragment.lines.filter((line) => line.html !== heading.html),
        ),
    ).toEqual(lines);
    expect(result.reserves.every((height) => height <= 192)).toBe(true);
  });
});

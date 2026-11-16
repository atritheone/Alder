import { expect,it } from "vitest";
import { columnGapAt,columnRulerEdges } from "./columnRuler";

it("locates gap edges and reverses their physical movement for equal columns",()=>{
  const edges=columnRulerEdges(600,3,24);
  expect(edges.map(e=>e.position)).toEqual([184,208,392,416]);
  for(const edge of edges)expect(columnGapAt(edge.position,edge,600,3)).toBeCloseTo(24);
  expect(columnGapAt(180,edges[0],600,3)).toBe(30);
  expect(columnGapAt(210,edges[1],600,3)).toBe(30);
});
it("limits gap resizing so each column retains its minimum writing space",()=>{
  const edge=columnRulerEdges(300,3,0)[0];
  const gap=columnGapAt(-10000,edge,300,3);
  expect((300-2*gap)/3).toBeCloseTo(20*96/25.4);
  expect(columnGapAt(10000,edge,300,3)).toBe(0);
  expect(columnRulerEdges(600,1,24)).toEqual([]);
});

import { expect,it } from "vitest";
import { fittedWriteZoom } from "./WriteZoom";

it("fits the complete page and adapts when a panel reduces the viewport",()=>{
  const paper={width:794,height:1123};
  const viewport={width:1000,height:700};
  const page=fittedWriteZoom("page",viewport,paper);
  expect(paper.height*page).toBeLessThanOrEqual(viewport.height-48+.000001);
  expect(paper.width*page).toBeLessThanOrEqual(viewport.width-48+.000001);
  expect(fittedWriteZoom("width",{width:600,height:700},paper)).toBeLessThan(fittedWriteZoom("width",viewport,paper));
  expect(paper).toEqual({width:794,height:1123});
});
it("honours the maximum zoom and fits a small writing viewport below 50 percent",()=>{
  expect(fittedWriteZoom("width",{width:5000,height:4000},{width:500,height:700})).toBe(3);
  expect(fittedWriteZoom("page",{width:700,height:350},{width:794,height:1123})).toBeLessThan(.5);
});

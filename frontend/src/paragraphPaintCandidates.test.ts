// @vitest-environment jsdom
import { expect, it } from "vitest";
import { paragraphPaintCandidates } from "./paragraphPaintCandidates";

const selector = 'table,blockquote,tr:not(.pagination-spacer)>td,tr:not(.pagination-spacer)>th,:is(p,h1,h2,h3,h4,h5,h6,pre)[style*="--alder-paragraph-paint"],p[data-style="painted"]';
it("retains nested table, list, block field and direct/named paragraph paint in DOM order", () => {
  const root = document.createElement("div");
  root.innerHTML = `<p>Plain <span class="discretionary-hyphen">\u00ad</span>words</p>
    <h2 style="--alder-paragraph-paint:1">Title</h2>
    <div class="form-block"><blockquote><p data-style="painted">Quoted</p></blockquote>
    <ul><li><p style="--alder-paragraph-paint:1">Item</p></li></ul></div>
    <div class="tableWrapper"><table><tbody><tr><th>Head</th><td><p data-style="painted">Cell</p>
    <table><tbody><tr><td><p>Nested</p></td></tr></tbody></table></td></tr></tbody></table></div>`;
  expect(paragraphPaintCandidates(root, selector)).toEqual([...root.querySelectorAll(selector)]);
  root.querySelector("p")!.style.setProperty("--alder-paragraph-paint", "1");
  root.querySelector('[data-style="painted"]')!.removeAttribute("data-style");
  expect(paragraphPaintCandidates(root, selector)).toEqual([...root.querySelectorAll(selector)]);
});

it("skips inline ink and pagination widgets entirely", () => {
  const root = document.createElement("div");
  root.innerHTML = '<p>Words<span>inline ink</span></p><div class="ProseMirror-widget"><table><tr><td>layout only</td></tr></table></div>';
  Object.defineProperty(root.firstElementChild, "firstElementChild", { get() { throw Error("Paragraph ink was traversed"); } });
  expect(paragraphPaintCandidates(root, selector)).toEqual([]);
});

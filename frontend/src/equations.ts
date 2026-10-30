import { Fragment, type NodeSpec } from "prosemirror-model";
import { NodeSelection, Plugin, type Command } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import type { DocNode } from "./types";

export const mathNamespace = "http://www.w3.org/1998/Math/MathML";
const tags = new Set(
  "math mrow mi mn mo mtext mspace mstyle mfrac msqrt mroot msub msup msubsup munder mover munderover mtable mtr mtd mpadded".split(
    " ",
  ),
);
const attributes = new Set(
  "display mathvariant displaystyle scriptlevel stretchy fence separator lspace rspace accent accentunder width height depth voffset linethickness columnalign columnspacing rowspacing minsize maxsize form".split(
    " ",
  ),
);
const arity: Record<string, number> = {
  mfrac: 2,
  mroot: 2,
  msub: 2,
  msup: 2,
  msubsup: 3,
  munder: 2,
  mover: 2,
  munderover: 3,
};
const tokens = new Set(["mi", "mn", "mo", "mtext"]);
export function parseMath(value: string) {
  if (typeof value !== "string" || value.length > 65536 || /<!|<\?/.test(value))
    throw new Error("Invalid or oversized equation.");
  const root = new DOMParser().parseFromString(
    value,
    "application/xml",
  ).documentElement;
  let count = 0;
  const visit = (n: Element, depth = 0) => {
    if (
      ++count > 2048 ||
      depth > 32 ||
      n.namespaceURI !== mathNamespace ||
      !tags.has(n.localName)
    )
      throw new Error(
        "This equation contains unsupported or overly complex MathML.",
      );
    for (const a of n.attributes)
      if (
        a.name !== "xmlns" &&
        (!attributes.has(a.name) ||
          a.value.length > 80 ||
          !/^[\w .+%\-,]*$/.test(a.value))
      )
        throw new Error("Unsupported equation attribute.");
    if (arity[n.localName] && n.children.length !== arity[n.localName])
      throw new Error("Invalid equation arguments.");
    if (n.localName === "math" && depth)
      throw new Error("Nested math roots are not supported.");
    if (
      ["mtable", "mtr"].includes(n.localName) &&
      (!n.children.length ||
        Array.from(n.children).some(
          (c) => c.localName !== (n.localName === "mtable" ? "mtr" : "mtd"),
        ))
    )
      throw new Error("Invalid equation matrix.");
    if (
      n.localName === "mtable" &&
      new Set(Array.from(n.children).map((row) => row.children.length)).size > 1
    )
      throw new Error("Matrix rows need the same number of cells.");
    if (
      ["mtr", "mtd"].includes(n.localName) &&
      n.parentElement?.localName !== (n.localName === "mtr" ? "mtable" : "mtr")
    )
      throw new Error("Invalid equation matrix cell.");
    if (n.localName === "mspace" && n.children.length)
      throw new Error("Equation spacing cannot contain terms.");
    if (tokens.has(n.localName) && n.children.length)
      throw new Error("An equation token must contain text.");
    if (
      !tokens.has(n.localName) &&
      Array.from(n.childNodes).some(
        (c) => c.nodeType === 3 && c.textContent?.trim(),
      )
    )
      throw new Error("Equation text needs a token.");
    for (const c of n.children) visit(c, depth + 1);
  };
  visit(root);
  if (root.localName !== "math")
    throw new Error("An equation needs a math root.");
  if (
    !Array.from(root.querySelectorAll("mi,mn,mo,mtext")).some((n) =>
      n.textContent?.trim(),
    )
  )
    throw new Error("An equation needs at least one term.");
  return root;
}
export function equationProperties(a: Record<string, any>) {
  parseMath(a.mathML);
  if (typeof (a.latex ?? "") !== "string" || (a.latex || "").length > 8192)
    throw new Error("Equation source is too long.");
  return {
    mathML: a.mathML as string,
    latex: (a.latex || "") as string,
    blockId: a.blockId || null,
  };
}
export function importedMath(n: Element) {
  const math = n.cloneNode(true) as Element;
  for (const semantics of math.querySelectorAll("semantics")) {
    const children = Array.from(semantics.children).filter(
      (c) => !["annotation", "annotation-xml"].includes(c.localName),
    );
    if (children.length !== 1)
      throw new Error("Unsupported equation semantics.");
    semantics.replaceWith(children[0]);
  }
  const value = new XMLSerializer().serializeToString(math);
  parseMath(value);
  return value;
}
export function validateEquation(node: DocNode) {
  equationProperties(node.attrs || {});
  const c = node.content || [];
  if (
    c.length !== 1 ||
    c[0].type !== "text" ||
    c[0].marks?.length ||
    c[0].content ||
    !c[0].text?.trim() ||
    c[0].text.length > 4096 ||
    node.marks?.length
  )
    throw new Error(
      "An equation needs a plain text reading description of at most 4096 characters.",
    );
}
export function describeMath(n: Element): string {
  const t = n.localName,
    v = Array.from(n.children).map(describeMath);
  if (tokens.has(t)) {
    const text = n.textContent?.trim() || "",
      words: Record<string, string> = {
        "+": "plus",
        "−": "minus",
        "-": "minus",
        "=": "equals",
        "±": "plus or minus",
        "×": "times",
        "÷": "divided by",
        "∑": "sum",
        "∏": "product",
        "∫": "integral",
        "∞": "infinity",
        "<": "less than",
        ">": "greater than",
        "≤": "less than or equal to",
        "≥": "greater than or equal to",
        "≠": "not equal to",
        α: "alpha",
        β: "beta",
        γ: "gamma",
        θ: "theta",
        π: "pi",
        Δ: "delta",
        "(": "open parenthesis",
        ")": "close parenthesis",
      };
    return words[text] ?? text;
  }
  if (t === "mspace") return "";
  if (t === "mfrac") return `fraction ${v[0]} over ${v[1]} end fraction`;
  if (t === "msqrt") return `square root of ${v.join(" ")} end root`;
  if (t === "mroot") return `root ${v[1]} of ${v[0]} end root`;
  if (t === "msub") return `${v[0]} subscript ${v[1]}`;
  if (t === "msup") return `${v[0]} to the power ${v[1]}`;
  if (t === "msubsup") return `${v[0]} subscript ${v[1]} to the power ${v[2]}`;
  if (t === "mover") {
    const accent = n.children[1].textContent || "",
      names: Record<string, string> = {
        "⃗": "vector",
        "→": "vector",
        "¯": "overline",
        "‾": "overline",
        ˆ: "hat",
        "̂": "hat",
        "~": "tilde",
        "˜": "tilde",
        "̃": "tilde",
        "˙": "dot",
        "̇": "dot",
        "¨": "double dot",
        "̈": "double dot",
      };
    if (names[accent]) return `${names[accent]} ${v[0]}`;
  }
  if (t === "munderover") return `${v[0]} from ${v[1]} to ${v[2]}`;
  if (t === "mover" || t === "munder")
    return `${v[0]} with ${v[1]} ${t === "mover" ? "above" : "below"}`;
  if (t === "mtable") return `matrix ${v.join("; ")} end matrix`;
  return v.filter(Boolean).join(" ");
}
const escapeText = (s: string) =>
  s.replace(/\\/g, "\\backslash ").replace(/[{}%&#_$]/g, "\\$&");
/** Import Office Math into the same local visual editor. No hidden conversion service. */
export function mathLatex(n: Element): string {
  const variant=n.getAttribute('mathvariant');
  if(variant){
    const commands:Record<string,string>={'normal':'mathrm','italic':'mathit','bold':'mathbf','bold-italic':'boldsymbol','double-struck':'mathbb','script':'mathcal','fraktur':'mathfrak','sans-serif':'mathsf','sans-serif-italic':'mathsfit','monospace':'mathtt'};
    const command=commands[variant];
    if(!command)throw new Error('This equation alphabet is preserved, but cannot be edited in the visual formula editor yet.');
    const copy=n.cloneNode(true) as Element;copy.removeAttribute('mathvariant');
    return `\\${command}{${mathLatex(copy)}}`;
  }
  const t = n.localName,
    v = Array.from(n.children).map(mathLatex),
    text = n.textContent || "";
  if (
    t === "mrow" &&
    n.children.length >= 3 &&
    [n.children[0], n.children[n.children.length - 1]].every(
      (x) => x.localName === "mo" && x.getAttribute("fence") === "true",
    )
  )
    return `\\left${v[0] || "."} ${v.slice(1, -1).join(" ")} \\right${v.at(-1) || "."}`;
  if (t === "mstyle" && n.getAttribute("displaystyle") === "true")
    return `{\\displaystyle ${v.join(" ")}}`;
  if (tokens.has(t)) {
    if (t === "mtext") return `\\text{${escapeText(text)}}`;
    const x = text.replace(/[{}%&#_$]/g, "\\$&");
    return x;
  }
  if (t === "mspace") return "\\,";
  if (t === "mfrac")
    return n.getAttribute("linethickness") === "0px"
      ? `\\genfrac{}{}{0pt}{}{${v[0]}}{${v[1]}}`
      : `\\frac{${v[0]}}{${v[1]}}`;
  if (t === "msqrt") return `\\sqrt{${v.join(" ")}}`;
  if (t === "mroot") return `\\sqrt[${v[1]}]{${v[0]}}`;
  if (t === "msub") return `{${v[0]}}_{${v[1]}}`;
  if (t === "msup") return `{${v[0]}}^{${v[1]}}`;
  if (t === "msubsup") return `{${v[0]}}_{${v[1]}}^{${v[2]}}`;
  if (t === "mover") {
    const accent = n.children[1].textContent || "",
      command: Record<string, string> = {
        "¯": "overline",
        "‾": "overline",
        "―": "overline",
        _: "overline",
        "⃗": "vec",
        "→": "vec",
        "^": "hat",
        ˆ: "hat",
        "^̂": "hat",
        "̂": "hat",
        "~": "tilde",
        "˜": "tilde",
        "̃": "tilde",
        "˙": "dot",
        "̇": "dot",
        "¨": "ddot",
        "̈": "ddot",
      };
    return command[accent]
      ? `\\${command[accent]}{${v[0]}}`
      : `\\overset{${v[1]}}{${v[0]}}`;
  }
  if (t === "munder") return `\\underset{${v[1]}}{${v[0]}}`;
  if (t === "munderover")
    return `\\overset{${v[2]}}{\\underset{${v[1]}}{${v[0]}}}`;
  if (t === "mtable") return `\\begin{matrix}${v.join("\\\\")}\\end{matrix}`;
  if (t === "mtr") return v.join(" & ");
  return v.join(" ");
}
export async function compileEquation(latex: string, display = false) {
  if (
    !latex.trim() ||
    latex.length > 8192 ||
    /\\(?:html|href|url|includegraphics|def|gdef|newcommand|renewcommand|require|class|style|cssId)/i.test(
      latex,
    )
  )
    throw new Error(
      "Use a formula without links, external resources or custom macros.",
    );
  const { default: katex } = await import("katex");
  const html = katex.renderToString(latex, {
    displayMode: display,
    output: "mathml",
    throwOnError: true,
    trust: false,
    strict: "error",
    maxExpand: 500,
    maxSize: 10,
  });
  const template = document.createElement("template");
  template.innerHTML = html;
  const math = template.content.querySelector("math")!;
  math.querySelectorAll("annotation").forEach((n) => n.remove());
  math
    .querySelectorAll("semantics")
    .forEach((n) => n.replaceWith(...n.childNodes));
  const value = new XMLSerializer().serializeToString(math);
  const root = parseMath(value);
  return { mathML: value, latex, description: describeMath(root) };
}
export const equationSpec: NodeSpec = {
  inline: true,
  group: "inline",
  content: "text*",
  marks: "",
  atom: true,
  draggable: true,
  attrs: {
    mathML: { default: "" },
    latex: { default: "" },
    blockId: { default: null },
  },
  parseDOM: [
    {
      tag: "span[data-equation]",
      priority: 100,
      getAttrs: (el) => {
        try {
          return equationProperties(
            JSON.parse(el.getAttribute("data-equation")!),
          );
        } catch {
          return false;
        }
      },
      contentElement: ".equation-description",
    },
    {
      tag: "math",
      priority: 90,
      getAttrs: (el) => {
        try {
          return { mathML: importedMath(el), latex: "", blockId: null };
        } catch {
          return false;
        }
      },
      getContent: (el, schema) =>
        Fragment.from(
          schema.text(describeMath(parseMath(importedMath(el as Element)))),
        ),
    },
  ],
  toDOM: (n) => {
    const dom = document.createElement("span");
    dom.className = "document-equation";
    dom.setAttribute("data-equation", JSON.stringify(n.attrs));
    dom.dataset.equationId = n.attrs.blockId;
    dom.contentEditable = "false";
    dom.setAttribute("role", "math");
    dom.setAttribute("aria-label", n.textContent);
    dom.title = "Equation: double-click or press Enter to edit";
    const math = document.importNode(parseMath(n.attrs.mathML), true);
    math.setAttribute("aria-hidden", "true");
    dom.append(math);
    const contentDOM = document.createElement("span");
    contentDOM.className = "equation-description";
    contentDOM.setAttribute("aria-hidden", "true");
    dom.append(contentDOM);
    return { dom, contentDOM };
  },
};
export function putEquation(
  attrs: Record<string, any>,
  description: string,
  id?: string,
): Command {
  return (state, dispatch) => {
    const json: DocNode = {
      type: "equation",
      attrs: {
        ...equationProperties(attrs),
        blockId: id || `equation_${crypto.randomUUID()}`,
      },
      content: [{ type: "text", text: description }],
    };
    validateEquation(json);
    const node = state.schema.nodeFromJSON(json),
      tr = closeHistory(state.tr);
    let pos = -1;
    if (id)
      state.doc.descendants((n, p) => {
        if (n.type.name === "equation" && n.attrs.blockId === id) pos = p;
      });
    if (id && pos < 0) return false;
    const display=parseMath(json.attrs!.mathML).getAttribute('display')==='block';
    const previous=id?state.doc.nodeAt(pos):null;
    const resolved=state.doc.resolve(id?pos:state.selection.from);
    const ownParagraph=resolved.parent.type.name==='paragraph'&&!!previous&&resolved.parent.childCount===1;
    if(display&&!ownParagraph){
      if(id)tr.setSelection(NodeSelection.create(tr.doc,pos));
      tr.replaceSelectionWith(state.schema.nodes.paragraph.create({align:'center'},node),false);
    } else if(id){
      tr.replaceWith(pos,pos+previous!.nodeSize,node);
      if(display&&parseMath(previous!.attrs.mathML).getAttribute('display')!=='block')tr.setNodeMarkup(resolved.before(),undefined,{...resolved.parent.attrs,align:'center'});
    } else tr.replaceSelectionWith(node, false);
    tr.doc.descendants((n, p) => {
      if (n.attrs.blockId === json.attrs!.blockId) pos = p;
    });
    if (pos < 0) return false;
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}
/** A correction or formatting command cannot partially edit the spoken cache. */
export const equationGuard = new Plugin({
  filterTransaction(tr, state) {
    if (!tr.docChanged) return true;
    // Inspect changed ranges only. A keystroke does not scan a whole long book.
    for (const [index, step] of tr.steps.entries()) {
      const value = step.toJSON(),
        before = tr.docs[index],
        after = tr.docs[index + 1] || tr.doc;
      if (typeof value.from === "number") {
        let inside = false;
        before.nodesBetween(
          Math.max(0, Math.min(value.from, before.content.size)),
          Math.max(0, Math.min(value.to ?? value.from, before.content.size)),
          (n, pos) => {
            if (
              n.type.name === "equation" &&
              (value.from > pos || (value.to ?? value.from) < pos + n.nodeSize)
            )
              inside = true;
          },
        );
        if (inside) return false;
      }
      let valid = true;
      const inspect = (from: number, to: number) =>
        after.nodesBetween(
          Math.max(0, Math.min(from, after.content.size)),
          Math.max(0, Math.min(to, after.content.size)),
          (n) => {
            if (n.type.name === "equation") {
              try {
                validateEquation(n.toJSON());
              } catch {
                valid = false;
              }
              return false;
            }
          },
        );
      step.getMap().forEach((_a, _b, from, to) => inspect(from, to));
      if (typeof value.from === "number")
        inspect(value.from, value.to ?? value.from);
      if (typeof value.pos === "number") inspect(value.pos, value.pos + 1);
      if (!valid) return false;
    }
    return true;
  },
});

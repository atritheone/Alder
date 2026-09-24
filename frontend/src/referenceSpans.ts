export type TextSpan = { start: number; end: number };
export type TextHeading = TextSpan & { text: string; level: number };

export function mergeSpans(spans: TextSpan[]): TextSpan[] {
  const result: TextSpan[] = [];
  for (const span of spans.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = result.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else result.push({ ...span });
  }
  return result;
}

const numbers = /^\d{1,4}(?:\s*[,;–—-]\s*\d{1,4})*$/u;
const referenceHeading =
  /^(?:references|bibliography|works cited|sources|citations|endnotes|footnotes|references and sources)$/i;
export function isReferenceHeading(text: string) {
  return referenceHeading.test(text.trim().replace(/:$/, ""));
}

/** Structural evidence, not a list of publishers: also works without link targets. */
export function referenceSpans(
  text: string,
  marked: TextSpan[] = [],
  protectedSpans: TextSpan[] = [],
  headings: TextHeading[] = [],
  superscripts: TextSpan[] = [],
): TextSpan[] {
  const spans = [...marked];
  const definitions = new Set<string>();
  const numericDefinitions = new Set<string>();
  const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    if (!isReferenceHeading(heading.text)) continue;
    const next = headings
      .slice(i + 1)
      .find((item) => item.level <= heading.level);
    const end = next?.start ?? text.length;
    spans.push({ start: heading.start, end });
    for (const entry of text
      .slice(heading.end, end)
      .matchAll(/^\s*(?:\[(\d+)\]|\((\d+)\)|(\d+)[.)])\s/gm))
      numericDefinitions.add(entry[1] || entry[2] || entry[3]);
  }
  const lines = [...text.matchAll(/^.*$/gm)];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const definition = line[0].match(/^ {0,3}\[([^\]\n]+)\]:\s*(.*)$/);
    if (
      definition &&
      (/^(?:<?https?:\/\/|www\.)/i.test(definition[2]) ||
        definition[1].startsWith("^"))
    ) {
      definitions.add(normalise(definition[1]));
      numericDefinitions.add(definition[1]);
      let end = line.index! + line[0].length;
      // Markdown continuation lines belong to the same reference definition.
      while (i + 1 < lines.length && /^(?: {2,}|\t)\S/.test(lines[i + 1][0])) {
        const next = lines[++i];
        end = next.index! + next[0].length;
      }
      spans.push({ start: line.index!, end });
    }
    const heading = line[0]
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/\s*#+\s*$/, "");
    if (
      isReferenceHeading(heading) &&
      !headings.some((item) => item.start === line.index)
    ) {
      // A plain-text heading needs bibliographic evidence in the following text.
      const tail = text.slice(line.index! + line[0].length);
      if (
        /^\s*(?:\[\d+\]|\d+[.)]|\[\^[^\]]+\]:)/.test(tail) ||
        /https?:\/\/|\b(?:18|19|20)\d{2}\b/.test(tail.slice(0, 1000))
      ) {
        const nextHeading = tail.match(/\n#{1,6}\s+\S/);
        const end = nextHeading
          ? line.index! + line[0].length + nextHeading.index!
          : text.length;
        spans.push({ start: line.index!, end });
        for (const entry of text
          .slice(line.index!, end)
          .matchAll(/^\s*(?:\[(\d+)\]|(\d+)[.)])\s/gm))
          numericDefinitions.add(entry[1] || entry[2]);
      }
    }
  }

  const pairs: (TextSpan & { open: string; inside: string })[] = [];
  const stack: { start: number; open: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\n") {
      stack.length = 0;
      continue;
    }
    if (char === "(" || char === "[") stack.push({ start: i, open: char });
    else if (char === ")" || char === "]") {
      const top = stack.at(-1);
      if (top && (top.open === "(" ? char === ")" : char === "]")) {
        stack.pop();
        if (i - top.start <= 2048)
          pairs.push({
            ...top,
            end: i + 1,
            inside: text.slice(top.start + 1, i),
          });
      }
    }
  }
  const byStart = new Map(pairs.map((pair) => [pair.start, pair]));
  for (const pair of pairs) {
    const value = pair.inside.trim();
    if (pair.open === "[") {
      let after = pair.end;
      while (text[after] === " " || text[after] === "\t") after++;
      const next = byStart.get(after);
      if (
        next &&
        ((next.open === "[" &&
          (numbers.test(next.inside) ||
            definitions.has(normalise(next.inside || value)))) ||
          (next.open === "(" &&
            /^(?:<?https?:\/\/|www\.)/i.test(next.inside.trim())))
      ) {
        spans.push({
          start:
            pair.start > 0 && text[pair.start - 1] === "!"
              ? pair.start - 1
              : pair.start,
          end: next.end,
        });
      }
      if (
        definitions.has(normalise(value)) ||
        /^\^[\w-]+$/.test(value) ||
        (numbers.test(value) &&
          !/[=+*/]\s*$/.test(
            text.slice(Math.max(0, pair.start - 4), pair.start),
          ))
      )
        spans.push(pair);
    } else if (
      numbers.test(value) &&
      value.split(/\s*[,;–—-]\s*/).every((n) => numericDefinitions.has(n))
    ) {
      spans.push(pair);
    }
    // Author-date citations require a name and year; ordinary calendar dates stay.
    const authorDate =
      /^(?:(?:see|e\.g\.|cf\.)\s+)?[\p{Lu}][\p{L}'’.-]*(?:\s+(?:[\p{Lu}][\p{L}'’.-]*|&|and)){0,6}(?:\s+et al\.)?,?\s+(?:18|19|20)\d{2}[a-z]?(?:,\s*(?:p{1,2}\.?\s*)?\d+(?:[–-]\d+)?)?$/u;
    if (
      !/^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(
        value,
      ) &&
      value.split(/;\s*/).every((part) => authorDate.test(part))
    )
      spans.push(pair);
  }
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>\[\]{}]+/gi)) {
    const value = match[0].replace(/[.,;:!?)}]+$/, "");
    spans.push({ start: match.index!, end: match.index! + value.length });
  }
  for (const span of superscripts) {
    if (
      text
        .slice(span.start, span.end)
        .split(/\s*[,;–-]\s*/)
        .every((n) => numericDefinitions.has(n))
    )
      spans.push(span);
  }

  // An omitted link/citation can leave an outer pair, including nested PMC labels.
  // A mask avoids searching the entire citation list for every bracket pair.
  const groups = mergeSpans(spans);
  for (let i = 1; i < groups.length; i++) {
    const start = groups[i - 1].end,
      end = groups[i].start;
    if (/^[ \t]*[,;][ \t]*$/.test(text.slice(start, end)))
      spans.push({ start, end });
  }
  const mask = new Uint8Array(text.length);
  for (const span of spans) mask.fill(1, span.start, span.end);
  for (const pair of pairs) {
    if (!mask.subarray(pair.start, pair.end).some(Boolean)) continue;
    let remaining = "";
    for (let i = pair.start + 1; i < pair.end - 1; i++)
      if (!mask[i]) remaining += text[i];
    if (
      /^\s*(?:(?:see(?: also)?|e\.g\.|cf\.|source:?)\s*)?[\s,;]*$/i.test(
        remaining,
      )
    ) {
      spans.push(pair);
      mask.fill(1, pair.start, pair.end);
    }
  }
  // Code and equations keep their literal notation even in a cited document.
  const protectedMask = new Uint8Array(text.length);
  for (const span of protectedSpans)
    protectedMask.fill(1, span.start, span.end);
  return mergeSpans(
    spans.filter(
      (span) => !protectedMask.subarray(span.start, span.end).some(Boolean),
    ),
  );
}

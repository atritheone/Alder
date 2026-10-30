import CSL from "citeproc";
import apa from "./citationAssets/apa.csl?raw";
import ieee from "./citationAssets/ieee.csl?raw";
import english from "./citationAssets/locales-en-US.xml?raw";
import {
  stableCitationJSON,
  validCitationItems,
  type CitationItem,
  type CitationSource,
  type CitationStyle,
} from "./citationTypes";
export type CitationInput = {
  style: CitationStyle;
  citations: { id: string; items: CitationItem[] }[];
};
export type CitationOutput = {
  citations: Record<string, string>;
  bibliography: { ids: string[]; html: string }[];
  hangingIndent: boolean;
  secondFieldAlign: boolean;
  lineSpacing: number;
  entrySpacing: number;
};
/** Called in a disposable worker, never on the typing/audio thread. No network,
 * arbitrary styles, HTML execution or global library state reaches the engine. */
export function processCitations(input: CitationInput): CitationOutput {
  if (!(input.style in { apa, ieee }))
    throw new Error("Choose a supported citation style.");
  const sources = new Map<string, CitationSource>(),
    signatures = new Map<string, string>(),
    ids = new Set<string>();
  for (const citation of input.citations) {
    if (ids.has(citation.id) || !validCitationItems(citation.items))
      throw new Error("Invalid or duplicate citation identity.");
    ids.add(citation.id);
    for (const item of citation.items) {
      const signature = stableCitationJSON(item.source),
        id = item.source.id;
      if (signatures.has(id) && signatures.get(id) !== signature)
        throw new Error(
          `Different versions of “${item.source.title || id}” occur in this document. Update its sources from the library before formatting citations.`,
        );
      sources.set(id, item.source);
      signatures.set(id, signature);
    }
  }
  const engine = new CSL.Engine(
    {
      retrieveLocale: (language: string) =>
        /^en(?:-|$)/.test(language) ? english : false,
      retrieveItem: (id: string) => structuredClone(sources.get(id)),
    },
    { apa, ieee }[input.style],
    "en-US",
  );
  engine.setOutputFormat("html");
  const order: [string, number][] = [],
    values: Record<string, string> = Object.create(null);
  for (const citation of input.citations) {
    const cluster = {
      citationID: citation.id,
      citationItems: citation.items.map((item) => ({
        id: item.source.id,
        ...(item.locator
          ? { locator: item.locator, label: item.label || "page" }
          : {}),
        ...(item.prefix ? { prefix: item.prefix } : {}),
        ...(item.suffix ? { suffix: item.suffix } : {}),
        ...(item.suppressAuthor ? { "suppress-author": true } : {}),
      })),
      properties: { noteIndex: 0 },
    };
    const result = engine.processCitationCluster(cluster, order, []);
    order.push([citation.id, 0]);
    for (const [index, html] of result[1]) values[order[index][0]] = html;
  }
  const bibliography = engine.makeBibliography();
  if (!bibliography)
    return {
      citations: values,
      bibliography: [],
      hangingIndent: false,
      secondFieldAlign: false,
      lineSpacing: 1,
      entrySpacing: 0,
    };
  if (bibliography[0].bibliography_errors?.length)
    throw new Error(
      "Some source details could not be formatted. Check the source metadata.",
    );
  return {
    citations: values,
    bibliography: bibliography[1].map((html: string, index: number) => ({
      html,
      ids: bibliography[0].entry_ids[index].map(String),
    })),
    hangingIndent: !!bibliography[0].hangingindent,
    secondFieldAlign: !!bibliography[0]["second-field-align"],
    lineSpacing: Number(bibliography[0].linespacing) || 1,
    entrySpacing: Number(bibliography[0].entryspacing) || 0,
  };
}

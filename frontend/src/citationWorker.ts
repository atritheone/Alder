import { processCitations, type CitationInput } from "./citationProcessor";
self.onmessage = (event: MessageEvent<CitationInput>) => {
  try {
    self.postMessage({ result: processCitations(event.data) });
  } catch (error) {
    self.postMessage({
      error: (error as Error).message || "Citation formatting failed.",
    });
  }
};

import { searchPatterns, type PatternRequest } from "./patternSearch";
self.onmessage = (event: MessageEvent<PatternRequest>) =>
  self.postMessage(searchPatterns(event.data));

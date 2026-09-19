export type DocNode = {
  type: string;
  attrs?: Record<string, any>;
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
  content?: DocNode[];
};
export type Device = {
  id: string;
  type: string;
  enabled: boolean;
  settings: Record<string, any>;
};
export type Track = {
  id: string;
  name: string;
  color: string;
  role: string;
  voiceId: string;
  muted: boolean;
  solo: boolean;
  devices: Device[];
};
export type Variant = {
  id: string;
  name: string;
  document: DocNode;
  text: string;
  createdAt: string;
};
export type Clip = {
  rawSource?: RawSource;
  rawFormat?: "markdown" | "html";
  createdAt?: string;
  updatedAt?: string;
  id: string;
  trackId: string;
  slot: number;
  title: string;
  document: DocNode;
  text: string;
  revision: number;
  variants: Variant[];
  activeVariantId: string | null;
  tags: string[];
  language: string;
  voiceId: string | null;
};
export type Placement = {
  id: string;
  clipId: string;
  sectionId: string;
  order: number;
  include: boolean;
  frozenDocument: DocNode | null;
  frozenText: string | null;
};
export type Section = {
  id: string;
  title: string;
  role: string;
  order: number;
};
export type Idea = {
  id: string;
  word: string;
  category: string;
  definition: string;
  pos: string;
  examples: string[];
  tags: string[];
};
export type Asset = { id: string; name: string; mime: string; path?: string };
export type PatternPart = {
  kind: string;
  value?: string;
  from?: string;
  to?: string;
  negate?: boolean;
  capture?: boolean;
  group?: number;
  min?: number;
  max?: number | null;
  greedy?: boolean;
  children?: PatternPart[];
  options?: PatternPart[][];
};
export type ReplacementPart = {
  kind: "text" | "group";
  text?: string;
  group?: number;
  case?: string;
};
export type Pronunciation = {
  syntax?: "rex";
  matchMode?: "whole" | "start" | "end" | "anywhere" | "pattern";
  enabled?: boolean;
  dictionary?: string;
  patternParts?: PatternPart[];
  replacementParts?: ReplacementPart[];
  rexOriginal?: string;
  regex?: boolean;
  id: string;
  word: string;
  spoken: string;
  caseSensitive: boolean;
  voiceId: string | null;
};
export type StyleKind = "paragraph" | "character";
export type StyleProperties = {
  fontFamily?: string | null;
  fontSize?: number | null;
  lineHeight?: number | null;
  spaceAfter?: number | null;
  color?: string | null;
  align?: "left" | "center" | "right" | "justify" | null;
  leftIndent?: number | null;
  firstLineIndent?: number | null;
};
export type NamedStyle = StyleProperties & {
  id: string;
  name: string;
  kind?: StyleKind;
  basedOn?: string | null;
};
export type Project = {
  lastImport?: { name: string; clipId?: string; warnings?: string[] };
  book?: { version: 1; chapters: Chapter[] };
  id: string;
  name: string;
  revision: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  language: string;
  tracks: Track[];
  clips: Clip[];
  placements: Placement[];
  sections: Section[];
  ideas: Idea[];
  dictionary: { word: string; definition: string; preferred: string | null }[];
  pronunciation: Pronunciation[];
  styles: NamedStyle[];
  settings: {
    pronunciationDictionaries?: string[];
    disabledPronunciationDictionaries?: string[];
    author: string;
    description: string;
    pageSize: string;
    marginMm: number;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    header: string;
    footer: boolean;
    [key: string]: any;
  };
  assets: Asset[];
};
export type RawSource = {
  format: "markdown" | "html";
  text: string;
  error?: string;
};
export type Chapter = {
  rawSource?: RawSource;
  rawFormat?: "markdown" | "html";
  id: string;
  title: string;
  role: string;
  document: DocNode;
  text: string;
  include: boolean;
  voiceId: string | null;
};
export type Annotation = {
  id: string;
  type: string;
  start: number;
  end: number;
  message: string;
  suggestion?: string;
  rule: string;
  ruleId?: string;
  ruleName?: string;
  originalText?: string;
  alternatives?: { label: string; edits: import("./proofreadingEdits").ProofreadingEdit[] }[];
  engine?: string;
};
export type Analysis = {
  annotations: Annotation[];
  words: number;
  sentences: number;
  readingSeconds: number;
};
export type Lexicon = {
  word: string;
  definitions: string[];
  synonyms: string[];
  antonyms: string[];
  forms: string[];
  suggestions: string[];
};
export type SpeechDifference = {
  type: string;
  expected: string;
  heard: string;
  expectedTokenStart?: number;
  expectedTokenEnd?: number;
  heardTokenStart?: number;
  heardTokenEnd?: number;
};
export type SpeechCheck = {
  status: string;
  matched?: boolean;
  expected?: string;
  transcript?: string;
  wordErrorRate?: number;
  expectedWords?: number;
  heardWords?: number;
  differences?: SpeechDifference[];
  error?: string;
  note?: string;
  model?: string;
  modelRevision?: string;
  checkedAt?: string;
  recognitionSeconds?: number;
  comparisonVersion?: number;
  segments?: {
    text: string;
    startSeconds: number;
    endSeconds: number;
    averageLogProbability?: number;
    noSpeechProbability?: number;
  }[];
};
export type SpeechAttempt = {
  index: number;
  seed: number;
  seconds?: number;
  createdAt?: string;
  file?: string;
  audioUrl?: string;
  qa?: SpeechCheck;
};
export type SpeechManualReview = {
  accepted: boolean;
  note: string;
  reviewedAt: string;
  sourceRevision: number;
  selectedAttempt?: number;
  selectedSeed: number;
  audioHash?: string;
  superseded?: boolean;
};
export type SpeechReviewRequest = {
  chunkId?: string;
  accepted: boolean;
  note?: string;
};
export type SpeechChunk = {
  provider?: string;
  buffering?: "immediate" | "reserve";
  timingSource?: string;
  timingEvidence?: "synthesis-events" | "recognition" | "unavailable";
  playbackEligible?: boolean;
  processingSeconds?: number;
  verificationStatus?: string;
  wordTimings?: {
    text: string;
    sourceStart: number;
    sourceEnd: number;
    startSeconds: number;
    endSeconds: number;
  }[];
  timingError?: string;
  id: string;
  text: string;
  spokenText?: string;
  status: string;
  seconds?: number;
  startSeconds?: number;
  audioUrl?: string;
  voiceId?: string;
  seed?: number;
  selectedSeed?: number;
  selectedAttempt?: number;
  qa?: SpeechCheck;
  qaAttempts?: SpeechAttempt[];
  qaComplete?: boolean;
  manualReview?: SpeechManualReview;
  reviewHistory?: SpeechManualReview[];
  cached?: boolean;
  sourceStart?: number;
  sourceEnd?: number;
  pronunciationMap?: {
    word: string;
    spoken: string;
    sourceStart: number;
    sourceEnd: number;
    spokenStart: number;
    spokenEnd: number;
  }[];
};
export type Job = {
  eventSequence?: number;
  settings?: { pauseSeconds?: number };
  id: string;
  projectId: string;
  sourceRevision: number;
  status: string;
  progress: number;
  message: string;
  text: string;
  chunks: SpeechChunk[];
  audioUrl?: string;
  createdAt: string;
  error?: string;
  reviewStatus?: string;
  manualReviewStatus?: string;
  manualReviewSummary?: { accepted: number; total: number };
  format?: string;
  seconds?: number;
  verify?: boolean;
  strictVerification?: boolean;
  verificationRetries?: number;
  verificationSummary?: {
    matched: number;
    needsReview: number;
    model: string;
    modelRevision?: string;
    comparisonVersion?: number;
  };
};
export type Voice = {
  id: string;
  name: string;
  system?: boolean;
  provider?: string;
  available?: boolean;
  culture?: string;
  reason?: string;
  [key: string]: any;
};
export type NativeMenuEntry = {
  id: string;
  label: string;
  checked?: boolean;
  submenu?: NativeMenuEntry[];
};
declare global {
  interface Window {
    alder?: {
      setWindowLayout: (mode: "start" | "workspace", width?: number, height?: number) => Promise<void>;
      setNativeMenu: (
        menus: { label: string; items: NativeMenuEntry[] }[] | null,
        background?: string,
      ) => Promise<void>;
      editCommand?: (
        command: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll",
      ) => Promise<void>;
      readClipboard?: () => Promise<string>;
      request: (method: string, path: string, body?: unknown) => Promise<any>;
      upload: (
        path: string,
        name: string,
        bytes: number[],
        fields?: Record<string, string>,
      ) => Promise<any>;
      saveText: (name: string, text: string) => Promise<string | null>;
      savePath: () => Promise<string | null>;
      openPath: () => Promise<string | null>;
      download: (path: string, name: string) => Promise<string | null>;
      mediaBase: string;
      onCloseRequest: (callback: () => Promise<void>) => () => void;
      onCommand: (callback: (command: string) => void) => () => void;
      platform: string;
      version: string;
      onOpenFiles?: (callback: (paths: string[]) => void) => () => void;
    };
  }
}

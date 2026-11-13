export type TextWorkspace = { id: string; path: string; name: string };
export type WorkspaceScan = {
  root: TextWorkspace;
  files: { relative: string; size: number }[];
  truncated: boolean;
  warnings: string[];
};
export type WorkspaceSource = {
  relative: string;
  text: string;
  digest: string;
};
export type WorkspaceEdit = {
  start: number;
  end: number;
  originalText: string;
  replacement: string;
};
export type WorkspaceReplacement = {
  relative: string;
  digest: string;
  edits: WorkspaceEdit[];
};
export type WorkspacePreview = {
  token: string;
  files: {
    relative: string;
    replacements: number;
    originalDigest: string;
    newDigest: string;
  }[];
};
export type WorkspaceCommit = {
  status: "passed" | "partial";
  written: number;
  total: number;
  backup: string;
  token: string;
  errors: string[];
};
export type WorkspaceRestore = {
  status: "passed" | "partial";
  restored: number;
  backup: string;
  errors: string[];
};

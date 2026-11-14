import type { Project } from "./types";
export type StartupIntent = { project?: Project; fresh?: boolean; files?: File[]; paths?: string[]; command?: string };

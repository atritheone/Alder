import type { Project } from "./types";

/** A request-owned language snapshot, independent of manuscript persistence. */
export function proofreadingContext(project: Project) {
  const keys = ["customRules", "ignoredRules", "ignoredRuleIds", "rules", "longSentenceWords",
    "proofreadingDialect", "proofreadingStyle", "sentenceRevisionProfile"] as const;
  return { language: project.language, dictionary: project.dictionary, ideas: project.ideas,
    settings: Object.fromEntries(keys.filter(key => project.settings[key] !== undefined)
      .map(key => [key, project.settings[key]])) };
}

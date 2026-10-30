import type { DocNode, Project } from "./types";
import { textLanguageSpans, type TextLanguageSpan } from "./textProjection";
import { resolveStyles } from "./styleResolution";

const cache = new WeakMap<DocNode, Map<string, TextLanguageSpan[]>>();
export type ProofreadingLanguageProject=Pick<Project,'language'|'styles'> & {settings:{[key:string]:unknown;proofreadingDialect?:string}};
export function proofreadingLanguages(
  document: DocNode | undefined,
  project: ProofreadingLanguageProject,
  language = project.language,
  text = "",
) {
  const dialect =
    project.settings.proofreadingDialect ||
    (["en-AU", "en-GB", "en-US"].includes(project.language)
      ? project.language
      : "en-GB");
  const fallback = !language || language.toLowerCase().split('-')[0] === "en" ? dialect : language;
  if (!document)
    return text ? [{ start: 0, end: text.length, language: fallback }] : [];
  const styles = new Map<string, string>();
  for (const [id, style] of resolveStyles(project.styles || []))
    if (style.textLanguage)
      styles.set(
        id,
        style.textLanguage === "en" ? dialect : style.textLanguage,
      );
  const key = JSON.stringify([fallback, dialect, [...styles]]);
  let context = cache.get(document);
  if (!context) {
    context = new Map();
    cache.set(document, context);
  }
  let result = context.get(key);
  if (!result) {
    result = textLanguageSpans(document, styles, fallback).map((span) =>
      span.language === "en" ? { ...span, language: dialect } : span,
    );
    if (context.size >= 4) context.delete(context.keys().next().value!);
    context.set(key, result);
  }
  return result;
}

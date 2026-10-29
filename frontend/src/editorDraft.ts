import type { Project } from "./types";
import { isDocumentJSON } from "./documentJSON";

/** Editor onChange callbacks replace document values; they do not edit the old
 * JSON tree. Clone their small project records and guard old documents instead
 * of copying every chapter's text runs for each keystroke. Other project
 * commands continue to receive a full private structured clone. */
export function createEditorDraft(project: Project) {
  const guards = new WeakMap<object, object>();
  const sources = new WeakMap<object, object>();
  const forbidden = () => {
    throw new Error(
      "Editor updates must replace document values, not mutate existing document nodes.",
    );
  };
  function guard(value: any): any {
    if (!value || typeof value !== "object") return value;
    const cached = guards.get(value);
    if (cached) return cached;
    const proxy = new Proxy(value, {
      get(target, key) {
        return guard(Reflect.get(target, key));
      },
      set: forbidden,
      deleteProperty: forbidden,
      defineProperty: forbidden,
      setPrototypeOf: forbidden,
      preventExtensions: forbidden,
    });
    guards.set(value, proxy);
    sources.set(proxy, value);
    return proxy;
  }
  function copy(value: any): any {
    if (!value || typeof value !== "object") return value;
    if (value.type === "doc") return guard(value);
    if (Array.isArray(value)) return value.map(copy);
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, copy(child)]),
    );
  }
  function finish(value: any): any {
    if (!value || typeof value !== "object") return value;
    const source = sources.get(value);
    if (source) return source;
    if (isDocumentJSON(value)) return value;
    let result = value;
    for (const key of Object.keys(value)) {
      const child = finish(value[key]);
      if (child !== value[key]) {
        if (result === value)
          result = Array.isArray(value) ? [...value] : { ...value };
        result[key] = child;
      }
    }
    return result;
  }
  const draft = copy(project) as Project;
  return { project: draft, finish: () => finish(draft) as Project };
}

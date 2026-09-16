import { mediaUrl } from "./api";
export const DOCUMENT_FONT = "Liberation Serif";
export type FontCatalogue = {
  families: string[];
  bundled?: string[];
  fallback?: string;
};
const loaded = new Map<string, Promise<void>>();
const faces = new Map<string, FontFace[]>();
export function loadDocumentFont(family = DOCUMENT_FONT) {
  if (!loaded.has(family)) {
    const task = Promise.all(
      [
        ["Regular", "400", "normal"],
        ["Bold", "700", "normal"],
        ["Italic", "400", "italic"],
        ["BoldItalic", "700", "italic"],
      ].map(async ([face, weight, style]) => {
        const font = new FontFace(
          family,
          `url("${mediaUrl(`/api/fonts/bundled/LiberationSerif-${face}.ttf`)}")`,
          { weight, style },
        );
        await font.load();
        document.fonts.add(font);
        faces.set(family, [...(faces.get(family) || []), font]);
      }),
    ).then(() => {
      window.dispatchEvent(new Event("alder-fonts-changed"));
    });
    loaded.set(family, task);
    task.catch(() => loaded.delete(family));
  }
  return loaded.get(family)!;
}
export function fontIsAvailable(family: string, catalogue: FontCatalogue) {
  if (/^(serif|sans-serif|monospace|system-ui|cursive|fantasy)$/i.test(family))
    return true;
  return catalogue.families.some(
    (font) => font.toLocaleLowerCase() === family.toLocaleLowerCase(),
  );
}

export function restoreInstalledFonts(catalogue: FontCatalogue) {
  for (const [family, fonts] of faces) {
    if (family !== DOCUMENT_FONT && fontIsAvailable(family, catalogue)) {
      for (const font of fonts) document.fonts.delete(font);
      faces.delete(family);
      loaded.delete(family);
      window.dispatchEvent(new Event("alder-fonts-changed"));
    }
  }
}

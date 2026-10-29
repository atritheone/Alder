export const cropEdges = ["left", "top", "right", "bottom"] as const;
export type ImageCrop = Record<(typeof cropEdges)[number], number>;
export function imageCrop(value: unknown): ImageCrop | null {
  if (value == null) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !cropEdges.includes(key as keyof ImageCrop),
    )
  )
    throw new Error("Invalid image crop.");
  const crop = Object.fromEntries(
    cropEdges.map((edge) => {
      const amount = (value as Partial<ImageCrop>)[edge] ?? 0;
      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > 99
      )
        throw new Error("Crop percentages must be between 0 and 99.");
      return [edge, Math.round(amount * 1000) / 1000];
    }),
  ) as ImageCrop;
  if (crop.left + crop.right > 99 || crop.top + crop.bottom > 99)
    throw new Error("Leave at least 1% of the image in each direction.");
  return cropEdges.some((edge) => crop[edge]) ? crop : null;
}
export function cropFromDOM(element: HTMLElement): ImageCrop | null {
  try {
    return imageCrop(
      JSON.parse(element.getAttribute("data-image-crop") || "null"),
    );
  } catch {
    return null;
  }
}
export function croppedImageSource(source: string, value: unknown) {
  const crop = imageCrop(value);
  return crop && source.startsWith("/api/projects/")
    ? `${source.split("?")[0]}?crop=${cropEdges.map((edge) => crop[edge]).join(",")}`
    : source;
}

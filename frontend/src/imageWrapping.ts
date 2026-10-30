export type ImageWrap = "none" | "left" | "right";
export function imageWrapping(attrs: Record<string, unknown>): {
  side: ImageWrap;
  gap: number;
} {
  const side = attrs.wrap || "none",
    gap = attrs.wrapGap ?? 12;
  if (!["none", "left", "right"].includes(side as string))
    throw new Error("Choose inline, left or right picture wrapping.");
  if (typeof gap !== "number" || !Number.isFinite(gap) || gap < 0 || gap > 192)
    throw new Error("Picture text spacing must be between 0 and 192 pixels.");
  return { side: side as ImageWrap, gap };
}
export function imageWrapStyle(attrs: Record<string, unknown>) {
  const { side, gap } = imageWrapping(attrs);
  return side === "none"
    ? ""
    : `float:${side};clear:${side};margin:0 ${side === "left" ? gap : 0}px ${gap}px ${side === "right" ? gap : 0}px`;
}

export function wrappingExclusions(root: HTMLElement, scale = 1) {
  let maximumBottom = -Infinity;
  return [
    ...root.querySelectorAll<HTMLElement>(
      '[data-image-wrap="left"],[data-image-wrap="right"]',
    ),
  ]
    .map((element) => ({
      element,
      rect: element.getBoundingClientRect(),
      css: getComputedStyle(element),
      scope: element.closest("td,th") || root,
    }))
    .sort((a, b) => a.rect.top - b.rect.top)
    .map((image) => {
      maximumBottom = Math.max(
        maximumBottom,
        image.rect.bottom + (parseFloat(image.css.marginBottom) || 0) * scale,
      );
      return { ...image, maximumBottom };
    });
}
/** Independently positioned page copies no longer share CSS floats. Recreate
 * the text exclusion only; the actual picture still has one semantic owner. */
export function freezeImageWrapping(
  source: Element,
  target: HTMLElement,
  scale: number,
  images: ReturnType<typeof wrappingExclusions>,
) {
  if (!images.length) return;
  const rect = source.getBoundingClientRect(),
    css = getComputedStyle(source);
  // Skip pictures entirely above/below this block. The prefix maximum also
  // handles overlapping left/right floats with different heights.
  let low = 0,
    high = images.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (images[middle].maximumBottom <= rect.top) low = middle + 1;
    else high = middle;
  }
  const active: typeof images = [];
  for (
    let index = low;
    index < images.length && images[index].rect.top < rect.bottom;
    index++
  )
    active.push(images[index]);
  if (!active.length) return;
  const left =
    rect.left +
    ((parseFloat(css.borderLeftWidth) || 0) +
      (parseFloat(css.paddingLeft) || 0)) *
      scale;
  const right =
    rect.right -
    ((parseFloat(css.borderRightWidth) || 0) +
      (parseFloat(css.paddingRight) || 0)) *
      scale;
  for (const side of ["left", "right"]) {
    const spans = active
      .filter(
        (image) =>
          !source.contains(image.element) &&
          image.css.cssFloat === side &&
          image.scope.contains(source) &&
          image.rect.bottom +
            (parseFloat(image.css.marginBottom) || 0) * scale >
            rect.top &&
          image.rect.top < rect.bottom,
      )
      .map((image) => ({
        top: Math.max(
          0,
          (image.rect.top - rect.top) / scale -
            (parseFloat(image.css.marginTop) || 0),
        ),
        bottom:
          (image.rect.bottom - rect.top) / scale +
          (parseFloat(image.css.marginBottom) || 0),
        width: Math.max(
          0,
          Math.min(
            (right - left) / scale,
            side === "left"
              ? (image.rect.right - left) / scale +
                  (parseFloat(image.css.marginRight) || 0)
              : (right - image.rect.left) / scale +
                  (parseFloat(image.css.marginLeft) || 0),
          ),
        ),
      }))
      .filter((span) => span.width > 0);
    if (!spans.length) continue;
    const width = Math.max(...spans.map((span) => span.width)),
      height = Math.max(...spans.map((span) => span.bottom));
    const stops = [
      ...new Set([0, ...spans.flatMap((span) => [span.top, span.bottom])]),
    ].sort((a, b) => a - b);
    const edge = side === "left" ? 0 : width,
      points = [`${edge}px 0px`];
    for (let i = 0; i < stops.length - 1; i++) {
      const middle = (stops[i] + stops[i + 1]) / 2;
      const amount = Math.max(
        0,
        ...spans
          .filter((span) => span.top <= middle && span.bottom > middle)
          .map((span) => span.width),
      );
      const x = side === "left" ? amount : width - amount;
      points.push(`${x}px ${stops[i]}px`, `${x}px ${stops[i + 1]}px`);
    }
    points.push(`${edge}px ${height}px`);
    const spacer = document.createElement("span");
    spacer.dataset.imageExclusion = "true";
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.cssText = `float:${side};width:${width}px;height:${height}px;shape-outside:polygon(${points.join(",")});margin:0;padding:0;border:0;pointer-events:none;user-select:none`;
    target.prepend(spacer);
  }
}

import type { ArrangementUnit } from "./arrangementUnits";
import { sentenceContents, sentencePreview } from "./sentencePreview";

export type UnitDropTarget = { pos: number; x: number; y: number };

/** Reuse page geometry for paragraph gaps and locally reflow sentence gaps.
 * No live editor mutations or whole-document pagination during a drag. */
export function unitDragFeedback(owner: HTMLElement, unit: ArrangementUnit) {
  const masks: HTMLElement[] = [];
  type Page = {
    snapshot: HTMLElement;
    targets: UnitDropTarget[];
    overlay?: HTMLElement;
    cover?: HTMLElement;
    shifted?: HTMLElement;
    gap?: HTMLElement;
    sentence?: ReturnType<typeof sentencePreview>;
    displacedTargets?: UnitDropTarget[];
  };
  const pages = new Map<HTMLElement, Page>();
  let active: Page | undefined;
  let activePosition: number | null = null;
  const key = `${unit.kind}:${unit.from}:${unit.to}`;
  const source = owner
    .querySelector<HTMLElement>(`[data-unit-key="${key}"]`)
    ?.closest<HTMLElement>(".page-snapshot");
  const sentenceHTML =
    unit.kind === "sentence" && source ? sentenceContents(source, unit) : "";
  owner
    .querySelectorAll<HTMLElement>(`[data-unit-key="${key}"]`)
    .forEach((layer) => {
      const snapshot = layer.closest<HTMLElement>(".page-snapshot")!;
      for (const outline of Array.from(layer.children) as HTMLElement[]) {
        const mask = document.createElement("div");
        mask.className = `unit-source-mask is-${unit.kind}`;
        mask.style.cssText = outline.style.cssText;
        snapshot.append(mask);
        masks.push(mask);
      }
    });
  function pageData(sheet: HTMLElement): Page {
    let data = pages.get(sheet);
    if (data) return data;
    const snapshot = sheet.querySelector<HTMLElement>(".page-snapshot")!;
    const targets: UnitDropTarget[] = [];
    snapshot
      .querySelectorAll<HTMLElement>(`.arrangement-unit.unit-${unit.kind}`)
      .forEach((layer) => {
        const other = JSON.parse(layer.dataset.unit!) as ArrangementUnit;
        if (other.from === unit.from && other.to === unit.to) return;
        const first = layer.firstElementChild as HTMLElement;
        const last = layer.lastElementChild as HTMLElement;
        if (!first || !last) return;
        // Read cached layout coordinates, not every text fragment's DOM bounds.
        targets.push(
          {
            pos: other.from,
            x: parseFloat(first.style.left),
            y:
              parseFloat(first.style.top) +
              (unit.kind === "sentence"
                ? parseFloat(first.style.height) / 2
                : 0),
          },
          {
            pos: other.to,
            x:
              parseFloat(last.style.left) +
              (unit.kind === "sentence" ? parseFloat(last.style.width) : 0),
            y:
              parseFloat(last.style.top) +
              parseFloat(last.style.height) *
                (unit.kind === "sentence" ? 0.5 : 1),
          },
        );
      });
    if (unit.kind === "sentence")
      snapshot
        .querySelectorAll<HTMLElement>(".unit-paragraph.is-empty")
        .forEach((layer) => {
          const other = JSON.parse(layer.dataset.unit!) as ArrangementUnit;
          const box = layer.firstElementChild as HTMLElement;
          if (box)
            targets.push({
              pos: other.from + 1,
              x: parseFloat(box.style.left),
              y: parseFloat(box.style.top),
            });
        });
    data = { snapshot, targets };
    pages.set(sheet, data);
    return data;
  }
  return {
    target(sheet: HTMLElement, clientX: number, clientY: number) {
      const data = pageData(sheet);
      const rect = sheet.getBoundingClientRect();
      const scale = rect.width / parseFloat(data.snapshot.style.width);
      const x = (clientX - rect.left) / scale,
        y = (clientY - rect.top) / scale;
      if (
        active === data &&
        activePosition !== null &&
        data.sentence?.contains(clientX, clientY)
      )
        return (
          data.targets.find((target) => target.pos === activePosition) || null
        );
      let best: UnitDropTarget | null = null,
        distance = Infinity;
      for (const target of (active === data
        ? data.displacedTargets
        : undefined) || data.targets) {
        const d = (target.x - x) ** 2 + (target.y - y) ** 2;
        if (d < distance) {
          best = target;
          distance = d;
        }
      }
      return best;
    },
    show(
      sheet: HTMLElement | null,
      target: UnitDropTarget | null,
      height: number,
    ) {
      const data = sheet && target ? pageData(sheet) : undefined;
      if (data === active && target?.pos === activePosition) return;
      if (active?.overlay) {
        active.overlay.hidden = true;
        active.gap?.classList.remove("is-unit-gap");
      }
      if (active?.sentence) {
        active.sentence.overlay.hidden = true;
        active.sentence.overlay
          .querySelectorAll(".is-unit-gap")
          .forEach((el) => el.classList.remove("is-unit-gap"));
      }
      active = data;
      activePosition = target?.pos ?? null;
      if (!data || !target) return;
      if (unit.kind === "sentence") {
        data.sentence ||= sentencePreview(data.snapshot, unit, sentenceHTML);
        data.sentence.overlay.hidden = false;
        data.sentence.update(target.pos);
        data.sentence.overlay
          .querySelector(".sentence-inline-gap")
          ?.classList.add("is-unit-gap");
        data.displacedTargets = data.targets.map((candidate) => ({
          ...candidate,
          ...data.sentence!.position(candidate.pos),
        }));
        return;
      }
      if (!data.overlay) {
        const shifted = data.snapshot.cloneNode(true) as HTMLElement;
        shifted
          .querySelectorAll(".arrangement-unit")
          .forEach((el) => el.remove());
        shifted.removeAttribute("data-page");
        shifted.classList.add("unit-displaced-copy");
        const overlay = document.createElement("div");
        overlay.className = "unit-drop-preview";
        const cover = document.createElement("div");
        cover.className = "unit-drop-cover";
        const gap = document.createElement("div");
        gap.className = "is-unit-gap unit-insertion-gap";
        overlay.append(cover, shifted, gap);
        data.snapshot.append(overlay);
        Object.assign(data, { overlay, cover, shifted, gap });
      }
      const margin = parseFloat(
        data.snapshot.style.getPropertyValue("--page-margin"),
      );
      const pageHeight = parseFloat(data.snapshot.style.height);
      const y = Math.max(margin, Math.min(pageHeight - margin - 4, target.y));
      const gapHeight = Math.max(8, Math.min(height, pageHeight - margin - y));
      data.overlay!.hidden = false;
      data.gap!.classList.add("is-unit-gap");
      data.cover!.style.top = `${y}px`;
      data.shifted!.style.clipPath = `inset(${y}px 0 0)`;
      data.shifted!.style.transform = `translateY(${gapHeight}px)`;
      data.gap!.style.cssText = `left:${margin}px;right:${margin}px;top:${y}px;height:${gapHeight}px;`;
    },
    destroy() {
      masks.forEach((mask) => mask.remove());
      pages.forEach((data) => {
        data.overlay?.remove();
        data.sentence?.destroy();
      });
      pages.clear();
    },
  };
}

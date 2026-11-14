import { useEffect } from "react";

/** Typing hides only the pointer; pointer movement and editor exit restore it. */
export function useTypingPointer() {
  useEffect(() => {
    let pointed: HTMLElement | null = null;
    let hidden: HTMLElement | null = null;
    const selector =
      '.ProseMirror[contenteditable="true"][aria-label="Chapter text editor"], .ProseMirror[contenteditable="true"][aria-label="Sandbox text editor"]';
    const isEditor = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest(selector));
    const show = () => { hidden?.classList.remove("alder-typing-pointer"); hidden = null; };
    const moved = (event: PointerEvent) => {
      show();
      pointed = event.target instanceof HTMLElement ? event.target : null;
    };
    const hide = (event: Event) => {
      if (!isEditor(event.target) || hidden?.isConnected) return;
      // A root class plus a universal descendant cursor rule invalidates every
      // text/decoration node on the first key. Only the hit-tested element
      // controls the stationary pointer; moving it restores that element.
      const hovered = pointed?.isConnected ? pointed : Array.from(document.querySelectorAll<HTMLElement>(":hover")).at(-1);
      if (hovered && hovered !== document.documentElement && hovered !== document.body) {
        hidden = hovered;
        hidden.classList.add("alder-typing-pointer");
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        event.key.length === 1 ||
        ["Enter", "Backspace", "Delete"].includes(event.key)
      )
        hide(event);
    };
    const focus = (event: FocusEvent) => {
      if (!isEditor(event.relatedTarget)) show();
    };
    document.addEventListener("keydown", key, true);
    document.addEventListener("beforeinput", hide, true);
    document.addEventListener("compositionstart", hide, true);
    document.addEventListener("pointermove", moved, true);
    document.addEventListener("pointerdown", show, true);
    document.addEventListener("wheel", show, { capture: true, passive: true });
    document.addEventListener("focusout", focus, true);
    window.addEventListener("blur", show);
    return () => {
      show();
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("beforeinput", hide, true);
      document.removeEventListener("compositionstart", hide, true);
      document.removeEventListener("pointermove", moved, true);
      document.removeEventListener("pointerdown", show, true);
      document.removeEventListener("wheel", show, true);
      document.removeEventListener("focusout", focus, true);
      window.removeEventListener("blur", show);
    };
  }, []);
}

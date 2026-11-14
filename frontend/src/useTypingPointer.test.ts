// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useTypingPointer } from "./useTypingPointer";

it("hides only the hovered element and restores it on movement and unmount", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  function Example() { useTypingPointer(); return createElement("div", null,
    createElement("button", null, "Toolbar"),
    createElement("div", { className: "ProseMirror", contentEditable: true, "aria-label": "Chapter text editor" })); }
  await act(async () => root.render(createElement(Example)));
  const button = host.querySelector("button")!, editor = host.querySelector(".ProseMirror")!;
  button.dispatchEvent(new Event("pointermove", { bubbles: true }));
  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
  expect(button.classList.contains("alder-typing-pointer")).toBe(true);
  expect(document.documentElement.classList.contains("alder-typing-pointer")).toBe(false);
  button.dispatchEvent(new Event("pointermove", { bubbles: true }));
  expect(button.classList.contains("alder-typing-pointer")).toBe(false);
  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
  await act(async () => root.unmount());
  expect(button.classList.contains("alder-typing-pointer")).toBe(false);
  host.remove();
});

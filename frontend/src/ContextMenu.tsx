import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ContextAction = {
  label: string;
  run: () => void;
  disabled?: boolean;
};
type Request = {
  x: number;
  y: number;
  items: ContextAction[];
  label: string;
  parent?: HTMLElement;
  alignRight?: boolean;
  className?: string;
  onClose?: () => void;
};
export function openContextMenu(
  event: { clientX: number; clientY: number; preventDefault(): void },
  items: ContextAction[],
  options: Partial<Omit<Request, "x" | "y" | "items">> = {},
) {
  event.preventDefault();
  document.dispatchEvent(
    new CustomEvent("alder-context-menu", {
      detail: {
        x: event.clientX,
        y: event.clientY,
        items,
        label: "Actions",
        ...options,
      },
    }),
  );
}
export function editCommand(
  command: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll",
) {
  if (window.alder?.editCommand) void window.alder.editCommand(command);
  else document.execCommand(command);
}

// Rows opt in with a selector for their existing action controls. Reusing those
// controls keeps availability, confirmations and the clicked item's identity intact.
export default function ContextMenus() {
  const [request, setRequest] = useState<Request | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const active = useRef<Request | null>(null);
  const restore = useRef<() => void>(() => {});
  const close = (focus = false) => {
    active.current?.onClose?.();
    active.current = null;
    popup.current?.hidePopover();
    setRequest(null);
    if (focus) restore.current();
  };
  useEffect(() => {
    const open = (event: Event) => {
      close();
      const next = (event as CustomEvent<Request>).detail;
      const focused = document.activeElement as HTMLElement | null;
      const selection = window.getSelection();
      const range = selection?.rangeCount
        ? selection.getRangeAt(0).cloneRange()
        : null;
      const field =
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement
          ? focused
          : null;
      const start = field?.selectionStart,
        end = field?.selectionEnd;
      restore.current = () => {
        if (!focused?.isConnected) return;
        focused.focus({ preventScroll: true });
        if (field && start != null && end != null)
          field.setSelectionRange(start, end);
        else if (range?.startContainer.isConnected && selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      };
      next.parent = focused?.closest("dialog[open]") || document.body;
      active.current = next;
      setRequest(next);
    };
    const context = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const target = event.target;
      const field = target.closest<HTMLInputElement | HTMLTextAreaElement>(
        "textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=password], input[type=number]",
      );
      if (field && !field.disabled) {
        field.focus({ preventScroll: true });
        const selected = field.selectionStart !== field.selectionEnd;
        openContextMenu(
          event,
          [
            {
              label: "Undo",
              disabled: field.readOnly,
              run: () => editCommand("undo"),
            },
            {
              label: "Redo",
              disabled: field.readOnly,
              run: () => editCommand("redo"),
            },
            {
              label: "Cut",
              disabled: field.readOnly || !selected,
              run: () => editCommand("cut"),
            },
            {
              label: "Copy",
              disabled: !selected,
              run: () => editCommand("copy"),
            },
            {
              label: "Paste",
              disabled: field.readOnly,
              run: () => editCommand("paste"),
            },
            { label: "Select all", run: () => field.select() },
          ],
          { label: "Text actions" },
        );
        return;
      }
      const row = target.closest<HTMLElement>("[data-context-actions]");
      if (row) {
        const selector = row.dataset.contextActions!;
        const controls =
          selector === "self"
            ? [row]
            : Array.from(row.querySelectorAll<HTMLElement>(selector));
        const items = controls
          .filter((control) => control.getClientRects().length > 0)
          .map((control) => ({
            label:
              control instanceof HTMLInputElement && control.type === "checkbox"
                ? control.checked
                  ? "Disable"
                  : "Enable"
                : control.dataset.contextLabel ||
                  control.getAttribute("aria-label") ||
                  control.textContent?.trim() ||
                  "Open",
            disabled: (control as HTMLButtonElement).disabled,
            run: () => {
              if (control.isConnected) control.click();
            },
          }));
        if (items.length) openContextMenu(event, items);
      } else if (
        window.getSelection()?.toString() &&
        !target.closest("button, select, .page-card")
      ) {
        openContextMenu(
          event,
          [{ label: "Copy", run: () => editCommand("copy") }],
          { label: "Text actions" },
        );
      }
    };
    const dismiss = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (!active.current) return;
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("alder-context-menu", open);
    document.addEventListener("contextmenu", context);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", dismiss);
    document.addEventListener("wheel", dismiss, true);
    return () => {
      document.removeEventListener("alder-context-menu", open);
      document.removeEventListener("contextmenu", context);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("wheel", dismiss, true);
    };
  }, []);
  useLayoutEffect(() => {
    const menu = popup.current;
    if (!menu || !request) return;
    menu.showPopover();
    const scale =
      Number(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--ui-scale",
        ),
      ) || 1;
    const rect = menu.getBoundingClientRect();
    const x = request.x - (request.alignRight ? rect.width : 0);
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)) / scale}px`;
    menu.style.top = `${Math.max(4, Math.min(request.y, window.innerHeight - rect.height - 4)) / scale}px`;
    menu
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [request]);
  return (
    request &&
    createPortal(
      <div
        ref={popup}
        popover="manual"
        role="menu"
        aria-label={request.label}
        className={`alder-context-menu ${request.className || ""}`}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          event.stopPropagation();
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                  buttons.length;
          buttons[next]?.focus();
        }}
      >
        {request.items.map((item, index) => (
          <button
            key={index}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              close(true);
              item.run();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>,
      request.parent || document.body,
    )
  );
}

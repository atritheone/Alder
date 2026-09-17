import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";

export type MenuEntry = {
  label: string;
  action?: () => void;
  checked?: boolean;
  submenu?: MenuEntry[];
};

export default function MenuItems({
  items,
  onClose,
}: {
  items: MenuEntry[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return items.map((item) => (
    <div
      className="menu-entry"
      key={item.label}
      onMouseEnter={() => setOpen(item.submenu ? item.label : null)}
      onMouseLeave={() => setOpen(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null);
      }}
      onKeyDown={(event) => {
        if (item.submenu && event.key === "ArrowRight") {
          event.preventDefault();
          setOpen(item.label);
          const entry = event.currentTarget;
          requestAnimationFrame(() => {
            entry
              .querySelector<HTMLButtonElement>(".menu-submenu button")
              ?.focus();
          });
        }
        if (
          item.submenu &&
          (event.key === "ArrowLeft" || event.key === "Escape") &&
          open === item.label
        ) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(null);
          event.currentTarget.querySelector("button")?.focus();
        }
      }}
    >
      <button
        role={item.checked === undefined ? "menuitem" : "menuitemradio"}
        aria-checked={item.checked}
        aria-haspopup={item.submenu ? "menu" : undefined}
        aria-expanded={item.submenu ? open === item.label : undefined}
        onClick={() => {
          if (item.submenu) setOpen(item.label);
          else {
            onClose();
            item.action?.();
          }
        }}
      >
        {item.checked !== undefined && (
          <span className="menu-check">
            {item.checked && <Check size={12} />}
          </span>
        )}
        {item.label}
        {item.submenu && <ChevronRight className="menu-arrow" size={12} />}
      </button>
      {item.submenu && open === item.label && (
        <div
          className="menu-popup menu-submenu"
          role="menu"
          aria-label={item.label}
        >
          <MenuItems items={item.submenu} onClose={onClose} />
        </div>
      )}
    </div>
  ));
}

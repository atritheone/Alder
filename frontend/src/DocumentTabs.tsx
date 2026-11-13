import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import "./document-tabs.css";

export default function DocumentTabs({
  documents,
  activeId,
  onSelect,
  onClose,
}: {
  documents: { id: string; name: string; modified?: boolean; path?: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("alder.pinnedDocumentTabs") || "[]",
      );
      return Array.isArray(value)
        ? value.filter((v) => typeof v === "string").slice(-100)
        : [];
    } catch {
      return [];
    }
  });
  const pin = (id: string) => {
    const next = pinned.includes(id)
      ? pinned.filter((p) => p !== id)
      : [...pinned, id].slice(-100);
    setPinned(next);
    try {
      localStorage.setItem("alder.pinnedDocumentTabs", JSON.stringify(next));
    } catch {
      /* Pinning remains usable in this session. */
    }
  };
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, documents.length]);
  if (!documents.length) return null;
  return (
    <div
      ref={strip}
      className="document-tabs"
      role="tablist"
      aria-label="Open documents"
    >
      {documents.map((item, index) => (
        <div className="document-tab" key={item.id}>
          <button
            role="tab"
            aria-selected={item.id === activeId}
            tabIndex={item.id === activeId ? 0 : -1}
            title={item.path || item.name}
            aria-label={item.name}
            onClick={() => onSelect(item.id)}
            onKeyDown={(e) => {
              const target =
                e.key === "ArrowLeft"
                  ? (index + documents.length - 1) % documents.length
                  : e.key === "ArrowRight"
                    ? (index + 1) % documents.length
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? documents.length - 1
                        : -1;
              if (target < 0) return;
              e.preventDefault();
              onSelect(documents[target].id);
              strip.current
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [target]?.focus();
            }}
          >
            {item.modified && (
              <span aria-hidden="true" title="Unsaved to file">
                ●{" "}
              </span>
            )}
            {pinned.includes(item.id) ? "📌 " : ""}
            {item.name}
          </button>
          <button
            aria-label={`${pinned.includes(item.id) ? "Unpin" : "Pin"} ${item.name}`}
            title={pinned.includes(item.id) ? "Unpin tab" : "Pin tab"}
            onClick={() => pin(item.id)}
          >
            {pinned.includes(item.id) ? "●" : "○"}
          </button>
          <button
            className="document-tab-close"
            aria-label={`Close ${item.name}`}
            title="Close document"
            onClick={() => onClose(item.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {documents.length > 1 && (
        <select
          aria-label="Close multiple tabs"
          value=""
          onChange={(e) => {
            const at = documents.findIndex((d) => d.id === activeId),
              scope = e.target.value;
            for (const [index, item] of documents.entries())
              if (
                !pinned.includes(item.id) &&
                (scope === "all" ||
                  (scope === "others" && item.id !== activeId) ||
                  (scope === "left" && index < at) ||
                  (scope === "right" && index > at))
              )
                onClose(item.id);
          }}
        >
          <option value="" disabled>
            Close tabs…
          </option>
          <option value="others">Other unpinned tabs</option>
          <option value="left">Unpinned tabs to the left</option>
          <option value="right">Unpinned tabs to the right</option>
          <option value="all">All unpinned tabs</option>
        </select>
      )}
    </div>
  );
}

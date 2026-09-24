import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import "./document-tabs.css";

export default function DocumentTabs({
  documents,
  activeId,
  onSelect,
  onClose,
}: {
  documents: { id: string; name: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, documents.length]);
  if (documents.length < 2) return null;
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
            title={item.name}
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
            {item.name}
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
    </div>
  );
}

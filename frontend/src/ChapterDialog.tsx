import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Chapter } from "./types";
import {
  chapterRoles,
  chapterRoleLabel,
  matterLabels,
  type BookMatter,
} from "./bookStructure";
import "./word-processing.css";

export default function ChapterDialog({
  initial,
  creating,
  onApply,
  onClose,
}: {
  initial: Chapter;
  creating: boolean;
  onApply: (value: Chapter) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [value, setValue] = useState(initial);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="word-dialog"
      aria-labelledby="chapter-properties-title"
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.title.trim())
            onApply({ ...value, title: value.title.trim() });
        }}
      >
        <header>
          <strong id="chapter-properties-title">
            {creating ? "Add chapter" : "Chapter properties"}
          </strong>
          <button
            type="button"
            aria-label="Close chapter properties"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Title
            <input
              autoFocus
              aria-label="Chapter name"
              value={value.title}
              required
              maxLength={300}
              onChange={(event) =>
                setValue({ ...value, title: event.target.value })
              }
            />
          </label>
          <label>
            Type
            <select
              aria-label="Chapter type"
              value={value.role}
              onChange={(event) => {
                const role = event.target.value,
                  untouched =
                    creating &&
                    (value.title === initial.title ||
                      value.title === chapterRoleLabel(value.role));
                setValue({
                  ...value,
                  role,
                  matter: undefined,
                  title: untouched ? chapterRoleLabel(role) : value.title,
                  showTitle: creating
                    ? !["titlepage", "copyright-page", "dedication"].includes(
                        role,
                      )
                    : value.showTitle,
                });
              }}
            >
              {!chapterRoles.some(([role]) => role === value.role) && (
                <option value={value.role}>{value.role}</option>
              )}
              {(Object.keys(matterLabels) as BookMatter[]).map((matter) => (
                <optgroup key={matter} label={matterLabels[matter]}>
                  {chapterRoles
                    .filter((item) => item[2] === matter)
                    .map(([role, label]) => (
                      <option key={role} value={role}>
                        {label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Book division
            <select
              aria-label="Book division"
              value={value.matter || ""}
              onChange={(event) =>
                setValue({
                  ...value,
                  matter: (event.target.value as BookMatter) || undefined,
                })
              }
            >
              <option value="">Automatic</option>
              {(Object.keys(matterLabels) as BookMatter[]).map((matter) => (
                <option key={matter} value={matter}>
                  {matterLabels[matter]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Show title in publication
            <input
              type="checkbox"
              checked={value.showTitle !== false}
              onChange={(event) =>
                setValue({ ...value, showTitle: event.target.checked })
              }
            />
          </label>
          <label>
            Include in book
            <input
              type="checkbox"
              checked={value.include}
              onChange={(event) =>
                setValue({ ...value, include: event.target.checked })
              }
            />
          </label>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            disabled={!value.title.trim()}
          >
            {creating ? "Add" : "Apply"}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

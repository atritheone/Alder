import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function LinkDialog({
  text,
  targets,
  onInsert,
  onClose,
}: {
  text: string;
  targets: { id: string; label: string; name: string }[];
  onInsert: (text: string, href: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState("web"),
    [url, setURL] = useState("https://"),
    [label, setLabel] = useState(text),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog"
      aria-label="Insert link"
      onCancel={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const target = targets.find((item) => item.id === destination);
            const href = target ? `#${target.id}` : url.trim();
            if (!target && !/^https?:\/\/[^\s]+$/i.test(href))
              throw new Error("Use an http or https web address.");
            const wording = label.trim() || target?.name || href;
            // Native modality must end before the editor restores keyboard focus.
            dialog.current?.close();
            onInsert(wording, href);
            onClose();
          } catch (e) {
            setError((e as Error).message);
            dialog.current?.showModal();
          }
        }}
      >
        <header>
          <strong>Insert link</strong>
          <button type="button" aria-label="Close link" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          {targets.length > 0 && (
            <label>
              Link to
              <select
                autoFocus
                aria-label="Link destination"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              >
                <option value="web">Web address</option>
                <optgroup label="Bookmarks">
                  {targets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          )}
          {destination === "web" && (
            <label>
              URL
              <input
                autoFocus={!targets.length}
                aria-label="URL"
                value={url}
                onChange={(event) => setURL(event.target.value)}
              />
            </label>
          )}
          <label>
            Link text
            <input
              aria-label="Link text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          {destination !== "web" && (
            <small>
              Ctrl-click the link to go to its bookmark (Command-click on Mac).
            </small>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="accent" type="submit">
            Insert
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

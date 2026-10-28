import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Asset } from "./types";
import "./word-processing.css";

const minimumWidthMm = 0.264583;
const maximumWidthMm = 2645.833333;

export default function ImageDialog({
  initial,
  assets,
  onApply,
  onClose,
}: {
  initial: Record<string, any>;
  assets: Asset[];
  onApply: (values: {
    width: number | null;
    align: string;
    alt: string;
    title: string | null;
    assetId?: string;
  }) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [width, setWidth] = useState(
    initial.width == null
      ? ""
      : String(
          Math.max(
            minimumWidthMm,
            Math.min(
              maximumWidthMm,
              Math.round(((Number(initial.width) * 25.4) / 96) * 100) / 100,
            ),
          ),
        ),
  );
  const [widthChanged, setWidthChanged] = useState(false);
  const [align, setAlign] = useState(initial.align || "left");
  const [alt, setAlt] = useState(initial.alt || "");
  const [title, setTitle] = useState(initial.title || "");
  const [assetId, setAssetId] = useState(initial.assetId || "");
  const choices = assets.filter((asset) => asset.mime.startsWith("image/"));
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      className="word-dialog"
      aria-label="Image properties"
      ref={dialog}
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply({
            width: !widthChanged
              ? initial.width == null
                ? null
                : Number(initial.width)
              : width === ""
                ? null
                : Math.max(
                    1,
                    Math.min(
                      10000,
                      Math.round(((Number(width) * 96) / 25.4) * 1000000) /
                        1000000,
                    ),
                  ),
            align,
            alt,
            title: title || null,
            ...(assetId && assetId !== initial.assetId ? { assetId } : {}),
          });
        }}
      >
        <header>
          <strong>Image properties</strong>
          <button
            type="button"
            aria-label="Close image properties"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Width (mm)
            <input
              aria-label="Image width (mm)"
              type="number"
              min={minimumWidthMm}
              max={maximumWidthMm}
              step="any"
              placeholder="Original size"
              value={width}
              onChange={(event) => {
                setWidth(event.target.value);
                setWidthChanged(true);
              }}
            />
          </label>
          <label>
            Alignment
            <select
              aria-label="Image alignment"
              value={align}
              onChange={(event) => setAlign(event.target.value)}
            >
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label>
            Alternative text
            <input
              aria-label="Image alternative text"
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
            />
          </label>
          <label>
            Title
            <input
              aria-label="Image title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {choices.length > 1 && (
            <label>
              Image
              <select
                aria-label="Image asset"
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                {!choices.some((asset) => asset.id === assetId) && (
                  <option value={assetId}>Current image</option>
                )}
                {choices.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <small>
            Height follows the original proportions. Oversized images fit the
            page.
          </small>
          <button
            type="button"
            onClick={() => {
              setWidth("");
              setWidthChanged(true);
            }}
          >
            Use original size
          </button>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="accent" type="submit">
            Apply
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

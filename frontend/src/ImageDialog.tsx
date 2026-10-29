import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Asset } from "./types";
import { cropEdges, imageCrop, type ImageCrop } from "./imageCrop";
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
    decorative: boolean;
    title: string | null;
    assetId?: string;
    placement: "inline" | "block";
    crop: ImageCrop | null;
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
  const [placement, setPlacement] = useState<"inline" | "block">(
    initial.placement || "block",
  );
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  const [alt, setAlt] = useState(initial.alt || "");
  const [decorative, setDecorative] = useState(!!initial.decorative);
  const [title, setTitle] = useState(initial.title || "");
  const [assetId, setAssetId] = useState(initial.assetId || "");
  const [crop, setCrop] = useState<ImageCrop>(
    initial.crop || { left: 0, top: 0, right: 0, bottom: 0 },
  );
  let cropError = "";
  try {
    imageCrop(crop);
  } catch (error) {
    cropError = (error as Error).message;
  }
  const choices = assets.filter((asset) => asset.mime.startsWith("image/"));
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      className="word-dialog"
      aria-label="Image properties"
      ref={dialog}
      onCancel={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (cropError) return;
          dialog.current?.close();
          onApply({
            crop: imageCrop(crop),
            placement,
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
            decorative,
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
            onClick={close}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Placement
            <select
              aria-label="Image placement"
              value={placement}
              onChange={(event) =>
                setPlacement(event.target.value as "inline" | "block")
              }
            >
              <option value="inline">In line with text</option>
              <option value="block">Own paragraph</option>
            </select>
          </label>
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
              disabled={placement === "inline"}
              value={align}
              onChange={(event) => setAlign(event.target.value)}
            >
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label>
            Decorative image
            <input
              type="checkbox"
              checked={decorative}
              onChange={(e) => setDecorative(e.target.checked)}
            />
          </label>
          <label>
            Alternative text
            <input
              aria-label="Image alternative text"
              disabled={decorative}
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
            Height follows the visible image’s proportions. Oversized images fit
            the page.
          </small>
          <details className="image-crop-fields">
            <summary>Crop</summary>
            <div className="word-dialog-fields">
              {cropEdges.map((edge) => (
                <label key={edge}>
                  {edge[0].toUpperCase() + edge.slice(1)} (%)
                  <input
                    aria-label={`Crop ${edge} (%)`}
                    type="number"
                    min="0"
                    max="99"
                    step="0.1"
                    value={crop[edge]}
                    onChange={(event) =>
                      setCrop({ ...crop, [edge]: Number(event.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
            <small>The original image is kept.</small>
            {cropError && <p role="alert">{cropError}</p>}
            <button
              type="button"
              onClick={() => setCrop({ left: 0, top: 0, right: 0, bottom: 0 })}
            >
              Remove crop
            </button>
          </details>
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
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="accent" type="submit" disabled={!!cropError}>
            Apply
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

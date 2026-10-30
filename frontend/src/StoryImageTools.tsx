import { useRef, useState } from "react";
import type { EditorView } from "prosemirror-view";
import { NodeSelection } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import ImageDialog from "./ImageDialog";
import { selectedImage, setImageProperties } from "./imageFormatting";
import { prepareRunningImages } from "./runningImages";
import type { Asset } from "./types";

export default function StoryImageTools({
  view,
  assets,
  projectId,
  onCollect,
  onError,
  label = "Header/footer",
}: {
  label?: string;
  view: EditorView | null;
  assets: Asset[];
  projectId: string;
  onCollect: (file: File) => Promise<Asset>;
  onError: (error: string) => void;
}) {
  const file = useRef<HTMLInputElement>(null),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<{
      attrs: Record<string, any>;
      state: EditorView["state"];
      pos: number;
    } | null>(null);
  const selected = view ? selectedImage(view.state) : null;
  const insert = async (asset: Asset, state: EditorView["state"]) => {
    const node = {
      type: "inline_image",
      attrs: {
        src: `/api/projects/${projectId}/assets/${asset.id}`,
        assetId: asset.id,
        alt: asset.name.replace(/\.[^.]+$/, ""),
        width: 96,
        blockId: crypto.randomUUID(),
      },
    };
    await prepareRunningImages([node]);
    if (!view || view.isDestroyed || view.state.doc !== state.doc)
      throw new Error(
        "The insertion point changed while loading the image. Insert it again.",
      );
    // File pickers and autosave can move DOM focus while bytes are collected.
    // Restore the captured selection only while its immutable document is
    // unchanged; a genuine edit still rejects the stale insertion.
    const tr = closeHistory(view.state.tr)
      .setSelection(state.selection)
      .replaceSelectionWith(view.state.schema.nodeFromJSON(node));
    view.dispatch(
      tr.setSelection(NodeSelection.create(tr.doc, tr.selection.from - 1)),
    );
    view.dispatch(closeHistory(view.state.tr));
    view.focus();
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <select
        aria-label={`${label} image`}
        value=""
        disabled={busy}
        onChange={(e) => {
          if (!view) return;
          const value = e.target.value;
          if (value === "upload") file.current?.click();
          else if (value === "properties" && selected)
            setEditing({
              attrs: {
                ...selected.node.attrs,
                placement: selected.node.isInline ? "inline" : "block",
              },
              state: view.state,
              pos: selected.pos,
            });
          else {
            const asset = assets.find((a) => a.id === value);
            if (asset) {
              const state = view.state;
              void run(() => insert(asset, state));
            }
          }
        }}
      >
        <option value="">Image…</option>
        <option value="upload">Add image…</option>
        <option value="properties" disabled={!selected}>
          Image properties…
        </option>
        {assets
          .filter((a) => a.mime.startsWith("image/"))
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
      <input
        ref={file}
        type="file"
        aria-label={`Add ${label.toLowerCase()} image`}
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          e.target.value = "";
          if (!chosen || !view) return;
          const state = view.state;
          void run(async () => insert(await onCollect(chosen), state));
        }}
      />
      {editing && (
        <ImageDialog
          initial={editing.attrs}
          assets={assets}
          onClose={() => {
            setEditing(null);
            view?.focus();
          }}
          onApply={(values) => {
            const target = editing;
            setEditing(null);
            void run(async () => {
              const asset = values.assetId
                ? assets.find((a) => a.id === values.assetId)
                : null;
              if (values.assetId && !asset)
                throw new Error("That image is no longer available.");
              const properties = {
                ...values,
                ...(asset
                  ? { src: `/api/projects/${projectId}/assets/${asset.id}` }
                  : {}),
              };
              await prepareRunningImages([
                {
                  type: "inline_image",
                  attrs: { ...target.attrs, ...properties },
                },
              ]);
              if (
                !view ||
                view.isDestroyed ||
                view.state.doc !== target.state.doc
              )
                throw new Error(
                  "The image changed. Select it again to edit its properties.",
                );
              const id = target.attrs.blockId || crypto.randomUUID();
              if (!target.attrs.blockId)
                view.dispatch(
                  closeHistory(view.state.tr).setNodeMarkup(
                    target.pos,
                    undefined,
                    {
                      ...view.state.doc.nodeAt(target.pos)!.attrs,
                      blockId: id,
                    },
                  ),
                );
              if (
                !setImageProperties(id, properties)(view.state, view.dispatch)
              )
                throw new Error(
                  "The image changed. Select it again to edit its properties.",
                );
              view.dispatch(closeHistory(view.state.tr));
              view.focus();
            });
          }}
        />
      )}
    </>
  );
}

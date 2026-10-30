import { useState } from "react";
import type { EditorView } from "prosemirror-view";
import type { Command } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import {
  addRowBefore,
  addRowAfter,
  addColumnBefore,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
  mergeCells,
  splitCell,
  toggleHeaderRow,
} from "prosemirror-tables";
import InsertTableDialog from "./InsertTableDialog";
import TableDialog from "./TableDialog";
import {
  selectedTableProperties,
  setTableProperties,
  sizeTableColumns,
  tableContext,
} from "./tableFormatting";

const actions: [string, Command][] = [
  ["Insert row above", addRowBefore],
  ["Insert row below", addRowAfter],
  ["Insert column left", addColumnBefore],
  ["Insert column right", addColumnAfter],
  ["Merge cells", mergeCells],
  ["Split cell", splitCell],
  ["Toggle heading row", toggleHeaderRow],
  [
    "Distribute columns evenly",
    (state, dispatch, view) => {
      const context = tableContext(state);
      if (!context) return false;
      if (!dispatch) return true;
      if (!view) return false;
      const dom = view.nodeDOM(context.tableStart - 1) as HTMLElement | null,
        width =
          dom?.querySelector("table")?.offsetWidth || view.dom.clientWidth;
      return sizeTableColumns(
        Array.from({ length: context.map.width }, () =>
          Math.max(25, Math.round(width / context.map.width)),
        ),
      )(state, dispatch);
    },
  ],
  ["Delete row", deleteRow],
  ["Delete column", deleteColumn],
  ["Delete table", deleteTable],
];

/** Reuses the body table dialogs and commands, within the story's own history. */
export default function StoryTableTools({
  view,
  onError,
  label = "Header/footer table",
}: {
  view: EditorView | null;
  onError: (message: string) => void;
  label?: string;
}) {
  const [insert, setInsert] = useState(false),
    [properties, setProperties] = useState<{
      initial: NonNullable<ReturnType<typeof selectedTableProperties>>;
      state: EditorView["state"];
    } | null>(null);
  return (
    <>
      <select
        aria-label={label}
        value=""
        onChange={(e) => {
          if (!view) return;
          if (e.target.value === "insert") setInsert(true);
          else if (e.target.value === "properties") {
            const initial = selectedTableProperties(view.state);
            if (initial) setProperties({ initial, state: view.state });
          } else {
            const action = actions.find(
              ([label]) => label === e.target.value,
            )?.[1];
            if (action) {
              view.dispatch(closeHistory(view.state.tr));
              action(view.state, view.dispatch, view);
              view.dispatch(closeHistory(view.state.tr));
              view.focus();
            }
          }
        }}
      >
        <option value="">Table…</option>
        <option value="insert">Insert table…</option>
        <option value="properties" disabled={!view || !deleteTable(view.state)}>
          Table properties…
        </option>
        {actions.map(([label, command]) => (
          <option key={label} disabled={!view || !command(view.state)}>
            {label}
          </option>
        ))}
      </select>
      {insert && (
        <InsertTableDialog
          onClose={() => {
            setInsert(false);
            view?.focus();
          }}
          onInsert={(rows, columns) => {
            if (!view) return;
            const { schema } = view.state,
              cell = () =>
                schema.nodes.table_cell.create(
                  null,
                  schema.nodes.paragraph.create(),
                ),
              row = () =>
                schema.nodes.table_row.create(
                  null,
                  Array.from({ length: columns }, cell),
                );
            view.dispatch(
              closeHistory(view.state.tr).replaceSelectionWith(
                schema.nodes.table.create(
                  null,
                  Array.from({ length: rows }, row),
                ),
              ),
            );
            view.dispatch(closeHistory(view.state.tr));
            setInsert(false);
            view.focus();
          }}
        />
      )}
      {properties && (
        <TableDialog
          initial={properties.initial}
          onClose={() => {
            setProperties(null);
            view?.focus();
          }}
          onApply={(values) => {
            if (
              !view ||
              view.state.doc !== properties.state.doc ||
              !view.state.selection.eq(properties.state.selection) ||
              !setTableProperties(properties.initial.identity, values)(
                view.state,
                view.dispatch,
              )
            )
              onError(
                "The selected table changed. Select it again to edit its properties.",
              );
            setProperties(null);
            view?.focus();
          }}
        />
      )}
    </>
  );
}

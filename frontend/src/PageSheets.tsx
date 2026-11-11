import { memo } from "react";
import type { Schema } from "prosemirror-model";
import { pageFrame } from "./sectionLayout";
import { PageFurniture } from "./pageFurniture";
import { columnRulesHTML } from "./columns";
import { lineNumbersHTML } from "./lineNumberLayout";
import { PageStructureGuides } from "./PageStructureGuides";
import {
  samePagePresentation,
  type PagePresentation,
} from "./pagePresentation";

type Props = PagePresentation & { schema: Schema; fontVersion: number };

// The editable body stays mounted separately. Text/position changes still reach
// the editor's page map, but unchanged sheet backgrounds need no React work.
export const PageSheets = memo(
  function PageSheets({ pages, headers, layout, schema, fontVersion }: Props) {
    return (
      <div className="page-sheets" aria-hidden="true">
        {Array.from({ length: Math.max(1, pages.length) }, (_, index) => {
          const page = pages[index],
            frame = pageFrame(pages, index, layout);
          return (
            <div
              className="page-sheet"
              key={index}
              style={{
                position: "absolute",
                top: frame.top,
                left: frame.left,
                width: frame.layout.width,
                height: frame.layout.height,
              }}
            >
              <PageStructureGuides layout={frame.layout} page={index} />
              {(page?.from !== page?.to || page?.noteHTML) && (
                <PageFurniture
                  layout={frame.layout}
                  page={index}
                  pageCount={pages.length}
                  schema={schema}
                  fontVersion={fontVersion}
                />
              )}
              {headers[index] && (
                <div dangerouslySetInnerHTML={{ __html: headers[index] }} />
              )}
              {page?.columnRules && (
                <div
                  dangerouslySetInnerHTML={{ __html: columnRulesHTML(page) }}
                />
              )}
              {page?.lineNumbers?.length ? (
                <div
                  dangerouslySetInnerHTML={{ __html: lineNumbersHTML(page) }}
                />
              ) : null}
              {page?.noteHTML && (
                <div dangerouslySetInnerHTML={{ __html: page.noteHTML }} />
              )}
            </div>
          );
        })}
      </div>
    );
  },
  (a, b) =>
    a.schema === b.schema &&
    a.fontVersion === b.fontVersion &&
    samePagePresentation(a, b),
);

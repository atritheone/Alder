import { validRevisionStamp } from "./trackedChanges";
import { validRevisionBreak } from "./trackedParagraphs";
import { validFormatLog } from "./trackedFormatting";
import { validParagraphFormatLog } from "./trackedParagraphFormatting";
import {parseBlockMove} from './trackedBlockMoves';
import {parseBlockChange} from './trackedBlockChanges';

/** Invalid revision metadata must not be treated as ordinary pasted text. */
export function validateReviewMarkup(root: ParentNode) {
  for (const element of root.querySelectorAll("*")) {
    const primary = ["insertion", "deletion", "break", "format"].filter(
      (kind) => element.hasAttribute(`data-revision-${kind}`),
    );
    try {
      if(element.hasAttribute('data-revision-block')){
        if(!/^(P|H[1-6]|TR|TD|TH|TABLE|LI|OL|UL)$/.test(element.tagName)||primary.length||element.hasAttribute('data-revision-block-move'))throw Error();
        parseBlockChange(element.getAttribute('data-revision-block'));
      }
      if(element.hasAttribute('data-revision-block-move')){
        if(!/^(P|H[1-6]|OL|UL|LI|TABLE|TR)$/.test(element.tagName)||primary.length)throw Error();
        parseBlockMove(element.getAttribute('data-revision-block-move'));
      }
      if (
        element.hasAttribute("data-revision-paragraph") &&
        !validParagraphFormatLog(
          JSON.parse(element.getAttribute("data-revision-paragraph") || "null"),
        )
      )
        throw new Error();
      if(element.hasAttribute('data-revision-paragraph')){
        const kind=JSON.parse(element.getAttribute('data-revision-paragraph')!).base.type;
        const tag=({table_cell:'TD',table_header:'TH',table:'TABLE',table_row:'TR',ordered_list:'OL',bullet_list:'UL'} as Record<string,string>)[kind];
        if(['ordered_list','bullet_list'].includes(kind)?!['OL','UL'].includes(element.tagName):tag?element.tagName!==tag:!/^(P|H[1-6])$/.test(element.tagName))throw Error();
      }
      if (primary.length > 1) throw new Error();
      if (
        !primary.some((kind) => kind === "insertion" || kind === "deletion") &&
        (element.hasAttribute("data-revision-author") ||
          element.hasAttribute("data-revision-date") ||
          element.hasAttribute("data-revision-move"))
      )
        throw new Error();
      if (element.hasAttribute("data-revision-move") && element.getAttribute("data-revision-move") !== "true")
        throw new Error();
      for (const kind of ["insertion", "deletion"])
        if (
          element.hasAttribute(`data-revision-${kind}`) &&
          !validRevisionStamp({
            id: element.getAttribute(`data-revision-${kind}`),
            author: element.getAttribute("data-revision-author") || "",
            date: element.getAttribute("data-revision-date") || "",
          })
        )
          throw new Error();
      if (
        element.hasAttribute("data-revision-break-content") &&
        !element.hasAttribute("data-revision-break")
      )
        throw new Error();
      if (
        element.hasAttribute("data-revision-break") &&
        !validRevisionBreak(
          JSON.parse(
            element.getAttribute("data-revision-break-content") || "null",
          ),
        )
      )
        throw new Error();
      if (
        element.hasAttribute("data-revision-format") &&
        !validFormatLog(
          JSON.parse(element.getAttribute("data-revision-format") || "null"),
        )
      )
        throw new Error();
    } catch {
      throw new Error(
        "Invalid tracked-change metadata. The source is kept; correct its revision metadata before importing it.",
      );
    }
  }
}

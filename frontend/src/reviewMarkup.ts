import { validRevisionStamp } from "./trackedChanges";
import { validRevisionBreak } from "./trackedParagraphs";
import { validFormatLog } from "./trackedFormatting";
import { validParagraphFormatLog } from "./trackedParagraphFormatting";

/** Invalid revision metadata must not be treated as ordinary pasted text. */
export function validateReviewMarkup(root: ParentNode) {
  for (const element of root.querySelectorAll("*")) {
    const primary = ["insertion", "deletion", "break", "format"].filter(
      (kind) => element.hasAttribute(`data-revision-${kind}`),
    );
    try {
      if (
        element.hasAttribute("data-revision-paragraph") &&
        !validParagraphFormatLog(
          JSON.parse(element.getAttribute("data-revision-paragraph") || "null"),
        )
      )
        throw new Error();
      if (primary.length > 1) throw new Error();
      if (
        !primary.some((kind) => kind === "insertion" || kind === "deletion") &&
        (element.hasAttribute("data-revision-author") ||
          element.hasAttribute("data-revision-date"))
      )
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

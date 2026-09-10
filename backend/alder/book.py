"""Book documents and a publication adapter for the original archive format."""
from copy import deepcopy


def publication_project(project: dict) -> dict:
    """Project chapter prose into the existing format writers, without mutation.

    Legacy scratch material must never leak into a book's output. Chapter order
    is the array order; physical pages are produced by typesetting the prose.
    """
    book = project.get("book")
    if book is None:
        return project
    p = deepcopy(project)
    p.pop("book", None)
    p["tracks"] = [{"id": "book-output", "voiceId": "default", "devices": []}]
    p["clips"], p["sections"], p["placements"] = [], [], []
    for order, chapter in enumerate(book["chapters"]):
        if not chapter.get("include", True):
            continue
        identifier = chapter["id"]
        p["sections"].append({"id": identifier, "title": chapter["title"], "role": chapter.get("role", "chapter"), "order": order})
        p["clips"].append({"id": identifier, "trackId": "book-output", "title": chapter["title"],
                           "document": deepcopy(chapter["document"]), "text": chapter["text"],
                           "variants": [], "voiceId": chapter.get("voiceId")})
        p["placements"].append({"id": "book-" + identifier, "clipId": identifier, "sectionId": identifier,
                                "order": 0, "include": chapter.get("include", True)})
    return p

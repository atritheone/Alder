"""Versioned semantic migrations. Archive container version is independent."""
from uuid import NAMESPACE_URL, uuid5
import re

VERSION = 2
BLOCKS = {
    "paragraph", "heading", "blockquote", "codeBlock", "code_block", "image",
    "bulletList", "bullet_list", "orderedList", "ordered_list", "listItem", "list_item",
    "table", "tableRow", "table_row", "tableCell", "table_cell", "tableHeader", "table_header",
    "horizontalRule", "horizontal_rule", "pageBreak", "page_break", "section_break",
}


def migrate_project(project):
    """Called on a validated copy; deterministic on repeat reads of old snapshots."""
    version = project.get("schemaVersion", 1)
    if type(version) is not int or version not in (1, VERSION):
        raise ValueError("This project uses an unsupported schema version. Its source has been preserved.")

    def document(root, scope):
        occupied = set()
        reserved = set()
        def reserve(node):
            identifier = (node.get("attrs") or {}).get("blockId")
            if isinstance(identifier, str):
                reserved.add(identifier)
            for child in node.get("content", []):
                reserve(child)
        reserve(root)

        def walk(node, path):
            if node["type"] in BLOCKS:
                attrs = node.setdefault("attrs", {})
                if attrs is None:
                    attrs = node["attrs"] = {}
                identifier = attrs.get("blockId")
                if identifier and (not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", identifier)):
                    raise ValueError("Invalid document block identity.")
                if not identifier or identifier in occupied:
                    # Old snapshots and copied subtrees acquire fresh identities;
                    # existing unique identifiers survive moves and normal edits.
                    seed = f"alder:{project['id']}:{scope}:{path}"
                    identifier = "block_" + uuid5(NAMESPACE_URL, seed).hex
                    while identifier in occupied or identifier in reserved:
                        identifier = "block_" + uuid5(NAMESPACE_URL, identifier).hex
                    attrs["blockId"] = identifier
                occupied.add(identifier)
            for index, child in enumerate(node.get("content", [])):
                walk(child, f"{path}/{index}")
        walk(root, "")

    for chapter in project.get("book", {}).get("chapters", []):
        document(chapter["document"], chapter["id"])
    for clip in project.get("clips", []):
        document(clip["document"], clip["id"])
        for variant in clip.get("variants", []):
            document(variant["document"], variant["id"])
    for placement in project.get("placements", []):
        if placement.get("frozenDocument") is not None:
            document(placement["frozenDocument"], placement["id"])
    project["schemaVersion"] = VERSION
    return project

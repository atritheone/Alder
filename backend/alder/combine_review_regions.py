"""Align reviewed paragraph groups against their shared original boundaries."""
from .document_comparison import canonical
from .document_revisions import review_document


def review_regions(document, baseline, regions):
    from .tracked_block_moves import block_move_context
    move_context=block_move_context(document)
    result = {key: [] for key in regions}
    indices, linked = {}, []
    nodes = document.get("content", [])
    cursor = index = 0
    while index < len(nodes):
        start = index
        node = nodes[index]
        change = node.get("attrs", {}).get("revisionMove") or node.get("attrs", {}).get("revisionBlock")
        insertion = change and change["kind"] == "insertion"
        chunk = [node]
        # An inserted boundary joins this paragraph back to the next one in the
        # original view. Keep the full chain, including joins within its parts.
        while True:
            targets = [c["attrs"]["nextId"] for c in chunk[-1].get("content", [])
                       if c["type"] == "revision_break" and c["attrs"]["kind"] == "insertion"]
            if not targets:
                break
            index += 1
            if len(targets) != 1 or index >= len(nodes) or nodes[index].get("attrs", {}).get("blockId") != targets[0]:
                raise ValueError("An original-view paragraph boundary has moved apart. Both copies are unchanged.")
            chunk.append(nodes[index])
        key = ("gap" if insertion else "body", cursor)
        if key not in result:
            raise ValueError("The review has an unsupported paragraph structure. Both copies are unchanged.")
        if not insertion:
            original = review_document({"type": "doc", "content": chunk}, "original",move_context).get("content", [])
            count = len(original)
            if not count or canonical({"type": "doc", "content": original}) != canonical({"type": "doc", "content": baseline[cursor:cursor + count]}):
                raise ValueError("The reviewed paragraphs no longer match their shared original.")
            if count > 1:
                # Include internal insertion gaps: an independent insertion
                # between paragraphs also conflicts with joining those paragraphs.
                linked.append([key for i in range(cursor, cursor + count)
                               for key in ([("body", i)] if i == cursor else [("gap", i), ("body", i)])])
        else:
            count = 0
        for offset, part in enumerate(chunk):
            indices[start + offset] = (key, len(result[key]))
            result[key].append(part)
        cursor += count
        index += 1
    if cursor != len(baseline):
        raise ValueError("The review is missing original paragraph evidence.")
    return result, indices, linked

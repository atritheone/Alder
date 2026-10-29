"""Versioned semantic migrations. Archive container version is independent."""
from uuid import NAMESPACE_URL, uuid5
import re

VERSION = 2
BLOCKS = {
    "table_of_contents",
    "revision_break",
    "comment_anchor",
    "bookmark", "bookmark_end", "cross_reference", "sequence", "document_field",
    "paragraph", "heading", "blockquote", "codeBlock", "code_block", "image", "inline_image",
    "bulletList", "bullet_list", "orderedList", "ordered_list", "listItem", "list_item",
    "table", "tableRow", "table_row", "tableCell", "table_cell", "tableHeader", "table_header",
    "horizontalRule", "horizontal_rule", "pageBreak", "page_break", "section_break",
}


def migrate_project(project):
    """Called on a validated copy; deterministic on repeat reads of old snapshots."""
    version = project.get("schemaVersion", 1)
    if type(version) is not int or version not in (1, VERSION):
        raise ValueError("This project uses an unsupported schema version. Its source has been preserved.")

    bookmark_ids = set()
    all_names = {}
    documents = []
    comment_ids = set()
    revision_ids = set()
    def document(root, scope):
        occupied = set()
        bookmark_names = set()
        bookmark_remap = {}
        local_bookmarks, link_marks = {}, []
        range_targets, range_ends = {}, []
        comment_remap = {}
        revision_remap = {}
        def revision_stamp(stamp):
            target = stamp['id']
            if target not in revision_remap:
                revision_remap[target] = 'change_' + uuid5(NAMESPACE_URL, f"alder:{project['id']}:{scope}:revision:{target}").hex if target in revision_ids else target
                revision_ids.add(revision_remap[target])
            stamp['id'] = revision_remap[target]
        fields, captions = [], []
        documents.append((local_bookmarks,link_marks,bookmark_remap,fields,captions))
        reserved = set()
        def reserve(node):
            identifier = (node.get("attrs") or {}).get("blockId")
            if isinstance(identifier, str):
                reserved.add(identifier)
            for child in node.get("content", []):
                reserve(child)
        reserve(root)

        def walk(node, path):
            for record in (node.get('attrs', {}).get('revisionProperties') or {}).get('records', []): revision_stamp(record['stamp'])
            if node['type'] == 'revision_break': revision_stamp(node['attrs']['stamp'])
            for mark in node.get('marks', []):
                if mark['type'] in ('revision_insertion', 'revision_deletion'): revision_stamp(mark['attrs'])
                elif mark['type'] == 'revision_format':
                    for record in mark['attrs']['records']: revision_stamp(record['stamp'])
            if node['type'] == 'comment_anchor':
                attrs = node['attrs']; target = attrs['threadId']
                if target not in comment_remap:
                    comment_remap[target] = 'comment_' + uuid5(NAMESPACE_URL, f"alder:{project['id']}:{scope}:comment:{target}").hex if target in comment_ids else target
                    comment_ids.add(comment_remap[target])
                attrs['threadId'] = comment_remap[target]
            if node["type"] in BLOCKS:
                attrs = node.setdefault("attrs", {})
                if attrs is None:
                    attrs = node["attrs"] = {}
                identifier = attrs.get("blockId")
                if identifier and (not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", identifier)):
                    raise ValueError("Invalid document block identity.")
                old_identifier = identifier
                destination = node['type'] in ('bookmark', 'heading', 'image', 'inline_image', 'table') or bool(attrs.get('captionLabel'))
                if not identifier or identifier in occupied or (destination and identifier in bookmark_ids):
                    # Old snapshots and copied subtrees acquire fresh identities;
                    # existing unique identifiers survive moves and normal edits.
                    seed = f"alder:{project['id']}:{scope}:{path}"
                    identifier = "block_" + uuid5(NAMESPACE_URL, seed).hex
                    while identifier in occupied or identifier in reserved or identifier in bookmark_ids:
                        identifier = "block_" + uuid5(NAMESPACE_URL, identifier).hex
                    attrs["blockId"] = identifier
                    if destination and old_identifier and old_identifier not in occupied:
                        bookmark_remap[old_identifier] = identifier
                occupied.add(identifier)
                if destination: bookmark_ids.add(identifier)
                if attrs.get('captionTargetId'): captions.append(attrs)
            if node["type"] == "bookmark":
                base = node["attrs"]["name"]; name=base; suffix=1
                while name.lower() in bookmark_names:
                    suffix += 1; tail=f"_{suffix}"; name=base[:40-len(tail)]+tail
                node["attrs"]["name"]=name; bookmark_names.add(name.lower())
                local_bookmarks[name]=node['attrs']['blockId']
                all_names.setdefault(name,set()).add(node['attrs']['blockId'])
                if old_identifier:
                    range_targets[old_identifier] = (node['attrs']['blockId'], name)
            elif node['type'] == 'bookmark_end':
                attrs = node['attrs']
                target = range_targets.get(attrs['targetId'])
                if target:
                    attrs.update(targetId=target[0], name=target[1])
                range_ends.append(attrs)
            elif node['type'] == 'cross_reference': fields.append(node['attrs'])
            for mark in node.get('marks',[]):
                if mark.get('type')=='link' and mark.get('attrs',{}).get('href','').startswith('#'):
                    link_marks.append(mark)
            for index, child in enumerate(node.get("content", [])):
                walk(child, f"{path}/{index}")
        walk(root, "")
        for attrs in range_ends:
            target = attrs['targetId']
            attrs['targetId'] = bookmark_remap.get(target) or local_bookmarks.get(target) or target

    for chapter in project.get("book", {}).get("chapters", []):
        document(chapter["document"], chapter["id"])
    for clip in project.get("clips", []):
        document(clip["document"], clip["id"])
        for variant in clip.get("variants", []):
            document(variant["document"], variant["id"])
    for placement in project.get("placements", []):
        if placement.get("frozenDocument") is not None:
            document(placement["frozenDocument"], placement["id"])
    from .running_matter import project_running_stories
    for index, story in enumerate(project_running_stories(project)):
        document(story, f'running-story:{index}')
    # Bind imported named links once. Renaming a bookmark then leaves its
    # references attached to the same identity, including across chapters.
    for local,marks,remap,fields,captions in documents:
        for attrs in captions:
            attrs['captionTargetId'] = remap.get(attrs['captionTargetId'], attrs['captionTargetId'])
        for attrs in fields:
            target = attrs['targetId']
            if target in remap: target = remap[target]
            elif target not in bookmark_ids:
                candidates = all_names.get(target, set())
                target = local.get(target) or (next(iter(candidates)) if len(candidates) == 1 else target)
            attrs['targetId'] = target
        for mark in marks:
            target=mark['attrs']['href'][1:]
            if target in remap: target=remap[target]
            elif target not in bookmark_ids:
                candidates=all_names.get(target,set())
                target=local.get(target) or (next(iter(candidates)) if len(candidates)==1 else target)
            mark['attrs']['href']='#'+target
    project["schemaVersion"] = VERSION
    return project

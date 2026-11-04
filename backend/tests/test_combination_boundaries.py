from copy import deepcopy
from pathlib import Path
import pytest

from alder.document_combination import combine_documents
from alder.document_revisions import review_document, revision_summary
from alder.document_comparison import canonical
from alder.models import document_text, validate_project
from alder.publishing import build_export, import_document
from test_document_combination import reviewed, check_original
from test_document_comparison import doc, para, project_fixture, commented, threads, DATE


def split_review(base, index=0, at=4, author="Alice", identity="split"):
    result = deepcopy(base)
    left = result["content"][index]
    text = left["content"][0]["text"]
    right = para(text[at:], **left.get("attrs", {}))
    right.setdefault("attrs", {})["blockId"] = identity + "_right"
    left["content"] = ([{"type": "text", "text": text[:at]}] if at else []) + [{
        "type": "revision_break", "attrs": {"kind": "insertion", "nextId": identity + "_right",
        "stamp": {"id": identity, "author": author, "date": DATE}}}]
    result["content"].insert(index + 1, right)
    return result


def join_review(base, index=0, author="Alice", identity="join"):
    result = deepcopy(base)
    left, right = result["content"][index:index + 2]
    left.setdefault("content", []).extend([{"type": "revision_break", "attrs": {
        "kind": "deletion", "stamp": {"id": identity, "author": author, "date": DATE},
        "rightType": right["type"], "rightAttrs": right.get("attrs", {})}}, *right.get("content", [])])
    del result["content"][index + 1]
    return result


@pytest.mark.parametrize("operation", [split_review, join_review])
def test_combines_boundary_changes_with_edits_outside_the_linked_paragraphs(operation):
    base = doc("One two.", "Next.", "Last.")
    a = operation(base)
    b = reviewed(base, doc("One two.", "Next.", "Last edited."), "Bob")
    snapshots = deepcopy((a, b))
    result = combine_documents(a, b)
    assert not result["conflicts"] and (a, b) == snapshots
    check_original(result["document"], base)
    expected = review_document(a, "final")
    expected["content"][-1] = para("Last edited.")
    assert canonical(review_document(result["document"], "final")) == canonical(expected)
    assert {c["author"] for c in revision_summary(result["document"])} == {"Alice", "Bob"}


@pytest.mark.parametrize("kind", ["split", "join", "internal-insert"])
def test_overlapping_boundary_regions_require_one_complete_choice(kind):
    base = doc("One two.", para("Next.", align="right"), "Last.")
    a = split_review(base) if kind == "split" else join_review(base)
    final = doc("Edited one two.", para("Next.", align="right"), "Last.") if kind == "split" else (
        doc("One two.", "Inserted.", para("Next.", align="right"), "Last.") if kind == "internal-insert" else
        doc("One two.", para("Changed next.", align="right"), "Last."))
    b = reviewed(base, final, "Bob")
    preview = combine_documents(a, b)
    assert len(preview["conflicts"]) == 1
    key = preview["conflicts"][0]["id"]
    for side, source in [("original", a), ("revised", b)]:
        result = combine_documents(a, b, {key: side})["document"]
        check_original(result, base)
        assert canonical(review_document(result, "final")) == canonical(review_document(source, "final"))
        assert {c["author"] for c in revision_summary(result)} == {"Alice" if side == "original" else "Bob"}


def test_equivalent_split_reviews_deduplicate_independent_anchor_ids():
    base = doc("One two.")
    a, b = split_review(base, identity="first"), split_review(base, identity="second")
    result = combine_documents(a, b)
    assert not result["conflicts"] and len(revision_summary(result["document"])) == 1
    check_original(result["document"], base)


def test_linked_split_chain_and_join_keep_comment_ranges():
    base = doc("One two three.", "Next.")
    a = split_review(split_review(base, at=4), index=1, at=4, identity="second")
    a["content"][2]["content"] = commented("three.", message="End comment.")["content"]
    b = join_review(base, author="Bob")
    preview = combine_documents(a, b)
    key = preview["conflicts"][0]["id"]
    result = combine_documents(a, b, {key: "revised"})
    assert len(threads(result["document"])) == 2
    body = result["document"]["content"][0]["content"]
    marked = False; quote = ""
    for node in body:
        if node["type"] == "comment_anchor": marked = node["attrs"]["edge"] == "start"
        elif marked: quote += node.get("text", "")
    assert quote == "three."
    assert document_text(review_document(result["document"], "original")) == document_text(base)


@pytest.mark.parametrize("format", ["docx", "html", "epub"])
def test_combined_boundaries_exchange_with_exact_original_and_final_paragraphs(tmp_path, format):
    base = doc("One two.", para("Next.", align="right"), "Third.", "Last.")
    a = split_review(base)
    b = join_review(base, index=2, author="Bob")
    result = combine_documents(a, b)
    assert not result["conflicts"]
    project = project_fixture("Boundaries", [])
    project["book"]["chapters"][0]["document"] = result["document"]
    project = validate_project(project)
    restored = import_document(Path(build_export(project, format, tmp_path)["path"]))["document"]
    assert {r["author"] for r in revision_summary(restored)} == {"Alice", "Bob"}
    for view in ("original", "final"):
        expected = review_document(result["document"], view)
        actual = review_document(restored, view)
        assert document_text(actual) == document_text(expected)
        assert len(actual["content"]) == len(expected["content"])


def test_incomplete_boundary_is_rejected_without_mutating_inputs():
    base = doc("One two.")
    a = split_review(base)
    a["content"].reverse()
    saved = deepcopy(a)
    with pytest.raises(ValueError, match="boundary"):
        combine_documents(a, base)
    assert a == saved


def test_comments_after_pending_deleted_words_use_markup_offsets():
    base = doc("Old prefix tail", "Other.")
    a = reviewed(base, doc("New prefix tail", "Other."), "Alice")
    content = []
    for node in a["content"][0]["content"]:
        if node.get("text", "").endswith("tail"):
            prefix = node["text"][:-4]
            if prefix: content.append({**node, "text": prefix})
            content.extend(commented("tail", message="Keep this range.")["content"])
        else: content.append(node)
    a["content"][0]["content"] = content
    b = reviewed(base, doc("Old prefix tail", "Changed other."), "Bob")
    result = combine_documents(a, b)
    assert not result["conflicts"]
    marked = False; quote = ""
    for node in result["document"]["content"][0]["content"]:
        if node["type"] == "comment_anchor": marked = node["attrs"]["edge"] == "start"
        elif marked: quote += node.get("text", "")
    assert quote == "tail"

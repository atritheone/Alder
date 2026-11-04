"""Two independent reviews with split/join evidence and one wording conflict."""
import json
import sys
from copy import deepcopy
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from alder.models import create_project, validate_project, document_text
from alder.document_comparison import compare_documents
from alder.document_combination import combine_documents
from alder.document_revisions import review_document, revision_summary
from alder.publishing import build_export, import_document

root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
if "--check" not in sys.argv:
    def paragraph(text): return {"type": "paragraph", "content": [{"type": "text", "text": text}]}
    def doc(*values): return {"type": "doc", "content": [paragraph(v) for v in values]}
    date = "2026-11-03T01:00:00Z"
    base = doc("Opening words continue.", "Disputed wording.", "Joined first.", "Joined second.")
    a = compare_documents(base, doc("Opening words continue.", "Alice wording.", "Joined first.", "Joined second."), "Alice", date)
    left = a["content"][0]
    right = paragraph("continue.")
    right["attrs"] = {**left.get("attrs", {}), "blockId": "split_right"}
    left["content"] = [{"type": "text", "text": "Opening words "}, {"type": "revision_break", "attrs": {
        "kind": "insertion", "nextId": "split_right", "stamp": {"id": "split_alice", "author": "Alice", "date": date}}}]
    a["content"].insert(1, right)
    b = compare_documents(base, doc("Opening words continue.", "Bob wording.", "Joined first.", "Joined second."), "Bob", date)
    left, right = b["content"][2:]
    left["content"].extend([{"type": "revision_break", "attrs": {
        "kind": "deletion", "rightType": right["type"], "rightAttrs": right.get("attrs", {}),
        "stamp": {"id": "join_bob", "author": "Bob", "date": date}}}, *right["content"]])
    b["content"].pop()
    def project(name, body):
        p = create_project(name, "blank")
        p["settings"].update(documentKind="docx", includeTitle=False)
        p["book"] = {"version": 1, "chapters": [{"id": "main", "title": "Text", "include": True, "document": body}]}
        return validate_project(p)
    inputs = [project("Alice boundaries", a), project("Bob boundaries", b)]
    preview = combine_documents(a, b)
    assert len(preview["conflicts"]) == 1 and preview["conflicts"][0]["paragraph"] == 2
    result = combine_documents(a, b, {preview["conflicts"][0]["id"]: "revised"})["document"]
    p = project("Combined boundaries", result)
    (root / "fixture-project.json").write_text(json.dumps(p), encoding="utf-8")
    (root / "fixture-inputs.json").write_text(json.dumps(inputs), encoding="utf-8")
    exported = build_export(p, "docx", root)
    (root / "fixture-exports.json").write_text(json.dumps({"docx": exported, "reviewDecisions": True,
        "skipListNumbers": True, "expectedText": ["Opening words"]}), encoding="utf-8")
else:
    source = json.loads((root / "fixture-project.json").read_text(encoding="utf-8"))["book"]["chapters"][0]["document"]
    restored = import_document(root / "word-resaved.docx")["document"]
    assert {c["author"] for c in revision_summary(restored)} == {"Alice", "Bob"}
    for decision, view in [("accept", "final"), ("reject", "original")]:
        expected = review_document(source, view)
        actual = review_document(restored, view)
        assert document_text(actual) == document_text(expected), (view, document_text(actual), document_text(expected))
        assert len(actual["content"]) == len(expected["content"])
        decided = import_document(root / f"word-{decision}.docx")["document"]
        assert not revision_summary(decided)
        assert document_text(decided) == document_text(expected)
        assert len(decided["content"]) == len(expected["content"])
    print(json.dumps({"status": "passed", "nativeBoundaries": True, "authors": True, "acceptAndReject": True}))

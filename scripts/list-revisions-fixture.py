import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path[:0]=[str(root/'backend'),str(root/'backend/tests')]
from test_list_revisions import fixture
from alder.publishing import build_export
directory=Path(sys.argv[1]).resolve();directory.mkdir(parents=True,exist_ok=True)
project=fixture()
if '--continued' in sys.argv and '--outline-kind' not in sys.argv:
    from test_list_revisions import continuation_fixture
    project=continuation_fixture(sys.argv[sys.argv.index('--continued')+1])
if '--outline' in sys.argv:
    from test_outline_revisions import fixture as outline_fixture
    project=outline_fixture()
if '--outline-continued' in sys.argv:
    from test_outline_revisions import continuation_fixture as outline_continuation_fixture
    project=outline_continuation_fixture(sys.argv[sys.argv.index('--outline-continued')+1])
if '--outline-paragraphs' in sys.argv:
    from test_outline_revisions import paragraph_fixture
    project=paragraph_fixture()
if '--outline-kind' in sys.argv:
    from test_outline_revisions import kind_fixture
    project=kind_fixture(int(sys.argv[sys.argv.index('--outline-kind')+1]),'--reverse' in sys.argv,'--continued' in sys.argv)
result=build_export(project,'docx',directory)
(directory/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
(directory/'fixture-exports.json').write_text(json.dumps({'docx':result,'reviewDecisions':True,'skipListNumbers':True,'expectedText':['OUTLINE_A' if any(flag in sys.argv for flag in ('--outline','--outline-continued','--outline-kind')) else 'Continuation wording']}),encoding='utf-8')
if '--outline-kind' in sys.argv:
    from alder.document_revisions import review_document,revision_summary
    from alder.models import document_text
    from test_outline_lists import labels
    source=project['book']['chapters'][0]['document']
    (directory/'fixture-inputs.json').write_text(json.dumps({'expectedText':['OUTLINE_A'],'outlineChange':{'level':int(sys.argv[sys.argv.index('--outline-kind')+1]),'reverse':'--reverse' in sys.argv},'original':review_document(source,'original'),'revised':review_document(source,'final'),'changes':len(revision_summary(source)),
        'text':{v:document_text(review_document(source,v)) for v in ('original','final')},'numberLabels':{v:labels(review_document(source,v)) for v in ('original','final')}}),encoding='utf-8')

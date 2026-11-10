"""Exercise the packaged backend with disposable legacy data, never user projects."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile


def verify(resources, expected_version, advanced=False):
    sys.path.insert(0, str(Path(resources)/'backend'))
    from alder import __version__
    from alder.models import create_project, text_document
    from alder.store import Store
    if __version__ != expected_version:
        raise RuntimeError(f'Packaged backend {__version__} differs from desktop {expected_version}')
    with tempfile.TemporaryDirectory(prefix='alder-document-upgrade-') as temp:
        store=Store(Path(temp)/'data')
        fresh=store.create('Fresh installation probe', 'blank')
        assert fresh['schemaVersion']==2
        old=create_project('Legacy update probe', 'blank')
        old['schemaVersion']=1
        old['clips'][0]['document']=text_document('Authored text before the update.')
        old['clips'][0]['text']='Authored text before the update.'
        snapshot=json.dumps(old)
        with store.connection() as conn:
            conn.execute('INSERT INTO projects VALUES (?,?,?,?,?,?)',
                         (old['id'],old['name'],old['revision'],old['updatedAt'],0,snapshot))
            conn.execute('INSERT INTO history VALUES (?,?,?)',(old['id'],0,snapshot))
            conn.commit()
        loaded=store.get(old['id'])
        assert loaded['schemaVersion']==2
        assert loaded['clips'][0]['text']==old['clips'][0]['text']
        assert loaded==store.get(old['id']), 'Migration must be deterministic'
        with store.connection() as conn:
            assert conn.execute('SELECT snapshot FROM projects WHERE id=?',(old['id'],)).fetchone()[0]==snapshot
        changed=deepcopy(loaded);changed['name']='Saved after update'
        saved=store.update(old['id'],changed,loaded['revision'])
        reopened=Store(Path(temp)/'data')
        assert reopened.get(old['id'])==saved
        assert saved['clips'][0]['text']==old['clips'][0]['text']
        with reopened.connection() as conn:
            assert conn.execute('SELECT snapshot FROM history WHERE project_id=? AND seq=0',(old['id'],)).fetchone()[0]==snapshot
            assert json.loads(conn.execute('SELECT snapshot FROM projects WHERE id=?',(old['id'],)).fetchone()[0])['schemaVersion']==2
    result={'status':'passed','version':__version__,'freshDocument':True,
            'legacyDocumentMigration':True,'authoredTextPreserved':True,
            'originalHistoryPreserved':True,'saveAndReopen':True,'isolatedData':True}
    if advanced:
        from alder.proofreading.contracts import configuration
        from alder.proofreading.engines import Resources, ModelEngine
        from alder.proofreading.revisions import revision
        engine=ModelEngine(Resources(resources))
        try:
            source='The reason why the meeting was cancelled was due to the fact that nobody had confirmed whether they would be attending.'
            for dialect in ('en-AU','en-GB','en-US'):
                config={**configuration({}, {'dialect':dialect}),'task':'revise','context':source}
                proposal=engine.check(source,config,lambda:False)
                assert revision(source,proposal,[]) is not None, 'Sentence revision probe failed: '+dialect
            clean='The train arrived before noon.'
            config={**configuration({}),'task':'revise','context':clean}
            assert engine.check(clean,config,lambda:False)==clean
            field='(Dr. Smith, 2020)'
            cited='The report '+field+' it contains several errors which needs correcting.'
            config={**configuration({}, {'acceptedWords':[field]}),'task':'revise','context':cited}
            assert revision(cited,engine.check(cited,config,lambda:False),[field]) is not None
            result['sentenceRevision']={'status':'passed','device':'cpu','dialects':['en-AU','en-GB','en-US'],
                                        'unchangedText':True,'citationPreserved':True,'qualityQualification':'not established'}
        finally:engine.close()
    else:result['sentenceRevision']={'status':'not requested'}
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources',type=Path,required=True)
    parser.add_argument('--expect-version',required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--advanced',action='store_true')
    args=parser.parse_args()
    result=verify(args.resources,args.expect_version,args.advanced)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result))

import hashlib
from fastapi.testclient import TestClient
from alder.app import create_app
from alder.models import text_document


def test_fingerprint_matches_export_bytes_and_plain_copy_retains_source(tmp_path):
    app=create_app(tmp_path / 'data')
    with TestClient(app) as client:
        project=client.post('/api/projects',json={'name':'TXT API','template':'blank'}).json()
        project['settings'].update(documentKind='txt',preferredFormat='txt',includeTitle=False,footer=False,
            textFile={'encoding':'utf-16-be','bom':True,'eol':'\r\n','convertEol':True})
        project['book']={'version':1,'chapters':[{'id':'main','title':'Text','role':'chapter','document':text_document('café\n')} ]}
        project=client.put('/api/projects/'+project['id'],json={'project':project,'expectedRevision':project['revision']}).json()
        fingerprint=client.get('/api/projects/'+project['id']+'/txt-file-fingerprint')
        assert fingerprint.status_code==200
        exported=client.post('/api/projects/'+project['id']+'/export',json={'format':'txt'}).json()
        raw=client.get(exported['downloadUrl']).content
        assert fingerprint.json()=={'revision':project['revision'],'digest':hashlib.sha256(raw).hexdigest()}
        copy=client.post('/api/projects/'+project['id']+'/plain-copy').json()
        assert copy['id']!=project['id']
        assert copy['book']['chapters'][0]['text']=='café\n'
        assert client.get('/api/projects/'+project['id']).json()==project
        reopened=client.post('/api/projects/'+project['id']+'/txt-reopen?encoding=utf-16-le',files={'file':('sample.txt','字\r\n'.encode('utf-16-le'))})
        assert reopened.status_code==200
        assert reopened.json()['book']['chapters'][0]['text']=='字\n'
        refused=client.post('/api/projects/'+project['id']+'/txt-reopen?encoding=utf-8',files={'file':('sample.txt',b'\xff')})
        assert refused.status_code==422
        assert client.get('/api/projects/'+project['id']).json()==project

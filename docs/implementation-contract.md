# Alder implementation contract

Current books add an optional `book: {version:1, chapters:Chapter[]}` aggregate. Chapter owns `id,title,role,document,text,include,voiceId`; array order is book order. The original tracks/clips/placements are retained for archive compatibility and independent scratch material, and are never the source of a converted book's publication. See [Book and reading](book-and-reading.md).

Original application integration contract, 10 September 2026. Frontend and Electron use the API below; backend modules separate persistence, language analysis, publishing and isolated speech workers. This describes integration boundaries rather than a generated API schema.

Python package: backend/alder. API FastAPI, default development port 8765 on 127.0.0.1, configured ALDER_DATA_DIR outside OneDrive (default LOCALAPPDATA/Alder). Optional ALDER_SESSION_TOKEN bearer auth, enabled by desktop shell; development loopback origins 127.0.0.1:5173 and localhost:5173. JSON camelCase throughout. Each service gets Store; heavy optional libraries load only inside relevant functions.

Project JSON (canonical persisted full snapshot): id, name, revision (integer), schemaVersion:1, createdAt, updatedAt, language:'en', tracks: Track[], clips: Clip[], placements: Placement[], sections: Section[], ideas: Idea[], dictionary: DictionaryEntry[], pronunciation: Pronunciation[], styles: Style[], settings: Settings, assets: Asset[]. Extra fields preserved where safe.

Track: id,name,color,role,voiceId:'default',muted:false,solo:false,devices:Device[]. Clip: id,trackId,slot(integer),title,document(ProseMirror JSON doc),text(derived exact paragraph plaintext),revision,variants:Variant[],activeVariantId:null,tags:string[],language:'en',voiceId:null. Variant: id,name,document,text,createdAt. Placement: id,clipId,sectionId,order,include:true,frozenDocument:null,frozenText:null. Section: id,title,role:'chapter',order. Idea: id,word,category,definition,pos,examples:string[],tags:string[]. DictionaryEntry: word,definition,preferred:string|null. Pronunciation: id,word,spoken,caseSensitive:false,voiceId:null. Style: id,name,fontFamily,fontSize,lineHeight,spaceAfter. Settings: author,description,pageSize:'A4',marginMm:22,fontFamily:'Georgia',fontSize:12,lineHeight:1.6,header:'',footer:true. Asset: id,name,mime,path(optional controlled internal reference). Device: id,type,enabled:true,settings:{}.

Core endpoints:
- GET /api/health -> {status,version,dataDir,capabilities}
- GET /api/projects -> {projects:[{id,name,updatedAt,revision}]}
- POST /api/projects {name?,template?:'blank'|'demo'|'essay'|'book'} -> Project
- GET /api/projects/{id} -> Project
- PUT /api/projects/{id} {expectedRevision,project} -> Project; 409 on conflict. Backend increments project revision; validate all foreign references and unique IDs, derive text from document.
- POST /api/projects/{id}/undo and /redo -> Project
- POST /api/projects/{id}/save {path?:string} -> {path}; .alder zip manifest/project JSON/database snapshot/assets; safe atomic save.
- POST /api/projects/open {path:string} -> Project
- GET /api/ideas?q=&category= -> {ideas:Idea[]}
- GET /api/lexicon?word=&projectId= -> {word,definitions:string[],synonyms:string[],antonyms:string[],forms:string[],suggestions:string[]}
- POST /api/analyze {text,projectId?,rules?:string[]} -> {annotations:[{id,type,start,end,message,suggestion?,rule}],words,sentences,readingSeconds}; offsets UTF-16.
- POST /api/transform {text,type,settings?} -> {text,changes?,message?}
- POST /api/projects/{id}/assets multipart file -> Asset (controlled storage), GET /api/projects/{id}/assets/{assetId} returns asset bytes.
- POST /api/projects/{id}/import multipart file -> Project (text/markdown/html/docx/epub supported by publishing helper; app integrates).

Publishing module contract: build_export(project:dict,format:str,output_dir:Path,options:dict|None=None)->dict with {path,filename,mime,warnings:list,validation:dict}; project_document(project)->list ordered section dicts {id,title,role,blocks:[ProseMirror nodes],text,clipIds}; import_document(path:Path)->dict {title,document,text,warnings,assets?}; render_html(project,options=None)->str. Python publishing module may add helpers. App exposes GET /api/projects/{id}/preview -> HTML; POST /api/projects/{id}/export {format,options?} -> result with downloadUrl; GET controlled export asset. No arbitrary paths accepted for file retrieval. Publishing module does not modify app.py. Agent reports dependencies for root requirements.

Speech module contract: SpeechService(data_dir:Path,project_root:Path), .capabilities()->dict, .voices()->list, .add_voice(path:Path,name:str)->dict, .submit(project:dict,request:dict)->dict, .list_jobs(project_id:str)->list, .get_job(job_id:str)->dict, .cancel(job_id:str)->dict, .resume(job_id:str)->dict, .audio_path(job_id:str,chunk_id:str|None=None)->Path, .shutdown(). No torch imports in app process. Speech request {text?,clipId?,scope:'clip'|'selection'|'collation',voiceId:'default',seed:42,temperature:0.8,format:'wav'}. Job {id,projectId,sourceRevision,status,progress,message,text,chunks:[{id,text,status,seconds?,startSeconds?,audioUrl?}],audioUrl?,createdAt,error?}. URLs /api/speech/jobs/{id}/audio and /api/speech/jobs/{id}/chunks/{chunkId}. App endpoints GET /api/speech/capabilities; GET /api/speech/voices -> {voices}; POST /api/speech/voices multipart file,name; POST /api/projects/{id}/speech -> Job; GET /api/projects/{id}/speech -> {jobs}; GET /api/speech/jobs/{id}; POST cancel/resume. Speech module persists its own resumable jobs and validates media access.

Tests: pytest backend/tests, TypeScript typecheck/build and browser end-to-end integration. No placeholder success for optional unavailable converters/engines: report real capabilities and errors. Core flow must run locally and offline after dependencies/models available.

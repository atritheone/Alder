"""Build an offline, blinded review packet from two recorded local model runs."""
import argparse
import hashlib
import json
from pathlib import Path
import random


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--first', type=Path, required=True)
    parser.add_argument('--second', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.output.resolve().is_relative_to(root):
        parser.error('Write generated review material outside the checkout.')
    if args.output.exists() and any(args.output.iterdir()):
        parser.error('Choose a new empty review directory to preserve existing review packets and ratings.')
    reports = [json.loads(path.read_text('utf-8')) for path in (args.first, args.second)]
    indexed = [{row['source']:row for row in report['records'] if row['status']=='completed'} for report in reports]
    common = sorted(set(indexed[0]) & set(indexed[1]))
    random.SystemRandom().shuffle(common)
    cases, key = [], {}
    for number, source in enumerate(common, 1):
        order = [0, 1]
        random.SystemRandom().shuffle(order)
        case_id = f'case-{number:02d}'
        cases.append({'id':case_id,'source':source,'A':indexed[order[0]][source]['proposal'],
                      'B':indexed[order[1]][source]['proposal']})
        key[case_id] = {letter:{'modelRevision':reports[index]['modelRevision'],
                               'report':str((args.first,args.second)[index].resolve())}
                       for letter,index in zip(('A','B'),order)}
    packet_id = hashlib.sha256(json.dumps(cases).encode()).hexdigest()[:16]
    data = json.dumps({'packetId':packet_id,'cases':cases},ensure_ascii=False).replace('<','\\u003c')
    html = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Alder sentence revision review</title><style>
body{font:17px/1.5 system-ui;max-width:1050px;margin:32px auto;padding:0 20px;color:#24342e;background:#f6f7f4}
header{position:sticky;top:0;background:#f6f7f4;padding:8px 0;border-bottom:1px solid #bbc9c0;z-index:1}
article{background:white;border:1px solid #ccd6ce;border-radius:8px;padding:22px;margin:22px 0}
.choices{display:grid;grid-template-columns:1fr 1fr;gap:24px}p{white-space:pre-wrap}select,textarea,button{font:inherit;padding:8px;max-width:100%}
select{width:100%}textarea{box-sizing:border-box;width:100%;min-height:60px}button{background:#245746;color:white;border:0;border-radius:4px;cursor:pointer}
@media(max-width:700px){.choices{grid-template-columns:1fr}}@media print{header{position:static}button{display:none}article{break-inside:avoid}}
</style><header><h1>Alder sentence revision review</h1><p>Judge each proposal against the original for grammar, meaning and usefulness.
Names, facts, conditions, certainty and voice should survive. Effective original wording may appropriately remain unchanged.
Model identities are hidden. This page works offline; no ratings are sent anywhere. Use Export ratings to save your answers.</p>
<button id="export">Export ratings</button> <span id="progress"></span></header><main id="cases"></main>
<script>const packet={{DATA}};let ratings={};try{ratings=JSON.parse(localStorage.getItem(packet.packetId)||'{}')}catch{}
const labels=[['','Choose a rating'],['good','Useful, grammatical, faithful revision'],['unchanged','Appropriately leaves good text unchanged'],
['unnecessary','Unnecessary or less natural'],['grammar','Contains a grammar problem'],['meaning','Changes or loses meaning'],['uncertain','Unsure']];
function save(){localStorage.setItem(packet.packetId,JSON.stringify(ratings));document.querySelector('#progress').textContent=
packet.cases.reduce((n,c)=>n+Number(Boolean(ratings[c.id]?.A))+Number(Boolean(ratings[c.id]?.B)),0)+' / '+(packet.cases.length*2)+' proposals rated'}
for(const item of packet.cases){const article=document.createElement('article');const heading=document.createElement('h2');heading.textContent=item.id;article.append(heading);
const original=document.createElement('p');original.textContent='Original: '+item.source;article.append(original);const choices=document.createElement('div');choices.className='choices';
for(const letter of ['A','B']){const panel=document.createElement('section');const name=document.createElement('h3');name.textContent='Proposal '+letter;panel.append(name);
const proposal=document.createElement('p');proposal.textContent=item[letter];panel.append(proposal);const select=document.createElement('select');select.setAttribute('aria-label',item.id+' proposal '+letter);
for(const [value,label]of labels){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option)}select.value=ratings[item.id]?.[letter]||'';
select.onchange=()=>{ratings[item.id]={...ratings[item.id],[letter]:select.value};save()};panel.append(select);choices.append(panel)}article.append(choices);
const notes=document.createElement('textarea');notes.placeholder='Optional notes: ambiguity, lost information, preferred wording';notes.setAttribute('aria-label',item.id+' notes');notes.value=ratings[item.id]?.notes||'';
notes.oninput=()=>{ratings[item.id]={...ratings[item.id],notes:notes.value};save()};article.append(notes);document.querySelector('#cases').append(article)}
document.querySelector('#export').onclick=()=>{const link=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify({packetId:packet.packetId,ratings},null,2)],{type:'application/json'}));
link.href=url;link.download='alder-sentence-ratings-'+packet.packetId+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};save();</script></html>'''
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/'review.html').write_text(html.replace('{{DATA}}',data),'utf-8')
    (args.output/'answer-key.json').write_text(json.dumps({'packetId':packet_id,'key':key},indent=2),'utf-8')
    (args.output/'cases.json').write_text(json.dumps({'packetId':packet_id,'cases':cases},ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps({'review':str((args.output/'review.html').resolve()),'cases':len(cases)}))


if __name__ == '__main__':
    main()

import { it, expect } from 'vitest';
import { schema } from './Editor';
import { documentNotes, chapterNoteStarts, assignPageNoteNumbers } from './documentNotes';
import { noteOptions } from './noteOptions';
import { referenceIndex } from './documentReferences';
import { hasPageReferences, pageReferenceValues } from './pageReferences';
import { validSection } from './sectionLayout';
import type { Project } from './types';
import type { PageLayout } from './pageFlow';

const body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Note wording'}]}]};
const note=(id:string)=>schema.node('paragraph',null,schema.node('document_note',{blockId:id,kind:'footnote',body}));
const section=(options:ReturnType<typeof noteOptions>|null)=>schema.node('section_break',{page:{pageSize:'A5'},noteOptions:options});
it('matches native Word continuous counts across section restarts, inherited formats and separate chapters',()=>{
  const base=noteOptions(),roman=noteOptions(),alpha=noteOptions(),decimal=noteOptions();
  base.footnote.start=3;
  roman.footnote={...roman.footnote,format:'upperRoman',start:7};
  alpha.footnote={...alpha.footnote,format:'lowerLetter',start:2,restart:'section'};
  decimal.footnote.start=8;
  const a=schema.node('doc',null,[note('a'),note('b'),section(roman),note('c'),note('d'),section(alpha),note('e')]),
    b=schema.node('doc',null,[note('f'),section(null),note('g'),note('h'),section(decimal),note('i'),note('j')]),
    all=schema.node('doc',null,[...Array.from({length:a.childCount},(_,i)=>a.child(i)),...Array.from({length:b.childCount},(_,i)=>b.child(i))]),
    expected=['3','4','IX','X','b','c','b','c','16','17'];
  expect(documentNotes(all,undefined,base).map(n=>n.number)).toEqual(expected);
  const project={settings:{noteOptions:base},book:{chapters:[{id:'a',document:a.toJSON()},{id:'excluded',include:false,document:all.toJSON()},{id:'b',document:b.toJSON()}]}} as Project;
  expect(documentNotes(b,chapterNoteStarts(project,'b'),base).map(n=>n.number)).toEqual(expected.slice(5));
  expect([...referenceIndex([{document:a.toJSON()},{document:b.toJSON()}],[],base).targets.values()].map(n=>n.number?.[0])).toEqual(expected);
});
it('measures section per-page overrides even when the document default is continuous',()=>{
  const options=noteOptions();options.footnote.restart='page';options.footnote.start=6;
  const doc=schema.node('doc',null,[note('a'),section(options),note('b'),note('c'),note('d')]);
  const split=doc.content.size-doc.lastChild!.nodeSize;
  const pages=[{from:0,to:doc.child(0).nodeSize,text:''},{from:doc.child(0).nodeSize,to:split,text:''},{from:split,to:doc.content.size,text:''}];
  assignPageNoteNumbers(doc,pages);
  expect(documentNotes(doc).map(n=>n.number)).toEqual(['1','6','7','6']);
  expect(pageReferenceValues(doc,pages,{} as PageLayout).noteNumbers).toEqual({a:'1',b:'6',c:'7',d:'6'});
  const json=doc.toJSON();json.content!.push({type:'paragraph',content:[{type:'cross_reference',attrs:{targetId:'b',referenceFormat:'number'}}]});
  expect(hasPageReferences({settings:{},book:{chapters:[{document:json}]}} as Project)).toBe(true);
  expect(validSection({kind:'nextPage',page:{},noteOptions:{footnote:{restart:'nonsense'}}})).toBe(false);
});

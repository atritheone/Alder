import {getDocument} from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const directory=path.resolve(process.argv[2]||"work/rich-notes-ui");
const task=getDocument({data:new Uint8Array(fs.readFileSync(path.join(directory,"notes.pdf")))});
const pdf=await task.promise,pages=[];
const descendants=node=>[node,...(node.children||[]).flatMap(descendants)];
const wording=node=>node.text||(node.children||[]).map(wording).join("");
try{
 for(let i=1;i<=pdf.numPages;i++){
  const page=await pdf.getPage(i),tree=await page.getStructTree(),content=await page.getTextContent({includeMarkedContent:true});
  assert(tree,`Missing page ${i} tags`);const stack=[],texts={};
  for(const item of content.items){
   if(item.type==="beginMarkedContent"||item.type==="beginMarkedContentProps")stack.push(item.id||null);
   else if(item.type==="endMarkedContent")stack.pop();
   else if(item.str){const key=stack.findLast(x=>x)||"untagged";texts[key]=(texts[key]||"")+item.str+" ";}
  }
  const walk=node=>node.type==="content"?{...node,text:texts[node.id]||""}:{...node,children:node.children?.map(walk)};
  pages.push({page:i,tree:walk(tree),texts});
 }
 const all=pages.flatMap(p=>descendants(p.tree)),text=pages.map(p=>wording(p.tree)).join(" ");
 const markers=[...Array.from({length:45},(_,i)=>`LONG${String(i).padStart(2,"0")}`),...Array.from({length:24},(_,i)=>i).filter(i=>i&&!([3,6].includes(i))).map(i=>`LEFT${String(i).padStart(2,"0")}`),...Array.from({length:23},(_,i)=>`RIGHT${String(i+1).padStart(2,"0")}`)];
 for(const marker of markers)assert.equal(text.split(marker).length-1,1,marker);
 const tables=all.filter(n=>n.role==="Table");assert(tables.length>=3);
 for(const table of tables){
  assert(wording(table).includes("LEFT00")&&wording(table).includes("RIGHT00"),"Continued table lost its semantic headers");
  assert.equal(descendants(table).filter(n=>n.role==="TH").length,2);
  assert(descendants(table).some(n=>n.role==="TR"));assert(descendants(table).some(n=>n.role==="TD"));
 }
 const long=all.find(n=>n.role==="TD"&&wording(n).includes("LONG00"));assert(long);
 assert(wording(long).indexOf("LONG01")>wording(long).indexOf("LONG00"));
 const lists=all.filter(n=>n.role==="L");assert(lists.length>=4);
 assert(lists.some(n=>/LIST\s+FIRST/.test(wording(n))&&descendants(n).filter(x=>x.role==="L").length===2));
 assert(lists.some(n=>/END\s+FIRST/.test(wording(n))&&descendants(n).filter(x=>x.role==="L").length===2));
 assert(all.some(n=>n.role==="LI"&&/NEW\s+LIST\s+ITEM/.test(wording(n))));
 fs.writeFileSync(path.join(directory,"structure.json"),JSON.stringify(pages,null,2));
 console.log(JSON.stringify({status:"passed",pages:pages.length,tableFragments:tables.length,lists:lists.length,uniqueNoteMarkers:markers.length}));
}finally{await task.destroy();}

import { _electron as electron } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"alder-hyphenation-"));
const app=await electron.launch({executablePath:desktopExecutable(),args:[".","--headless-test",`--user-data-dir=${profile}/profile`],env:{...process.env,ALDER_DATA_DIR:`${profile}/data`}});
try {
  const page=await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const result=await page.evaluate(async()=>{
    await document.fonts.ready;
    const probe=document.createElement("div");
    probe.style.cssText="position:fixed;left:0;top:0;font:16px Arial;white-space:normal;overflow-wrap:normal;word-break:normal;width:50px";
    document.body.append(probe);
    const result={};
    for(const [lang,word] of [["en-US","extraordinary"],["de","Silbentrennung"]]) {
      probe.lang=lang;probe.textContent=word;
      probe.style.hyphens="none";
      const before=probe.getBoundingClientRect().height;
      probe.style.hyphens="auto";
      await new Promise(resolve=>setTimeout(resolve,1000));
      result[lang]={before,after:probe.getBoundingClientRect().height,width:probe.scrollWidth};
    }
    probe.remove();return result;
  });
  fs.writeFileSync("work/hyphenation-probe.json",JSON.stringify(result,null,2));
} finally {await app.close();}

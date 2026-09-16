// Run the actual installed builder's validators before expensive assembly.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { platformBuilderConfig } from './platform-builder-config.mjs';
const require=createRequire(import.meta.url);
const { getConfig, validateConfiguration }=require('app-builder-lib/out/util/config/config');
const FpmTarget=require('app-builder-lib/out/targets/FpmTarget').default;
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const config=await getConfig(process.cwd(),null,null);
await validateConfiguration(config,{debugLogger:{isEnabled:false}});
const metadata=await FpmTarget.prototype.computeFpmMetaInfoOptions.call({
  packager:{appInfo:{computePackageUrl:async()=>pkg.homepage,linuxPackageName:pkg.name}},options:config.linux,
});
assert.equal(metadata.url,pkg.homepage);
assert.ok(metadata.url?.startsWith('https://'));
assert.equal(metadata.maintainer,'Alder <edward@atritheone.com>');
for (const [platform,label] of [['win32','Windows'],['linux','Linux'],['darwin','Mac']]) {
  const native=platformBuilderConfig(pkg,platform);
  await validateConfiguration(native,{debugLogger:{isEnabled:false}});
  assert.equal(native.extraMetadata.description,`Alder Organic Language Engine for ${label}`);
}
assert.equal(config.extraResources.length,new Set(config.extraResources.map(x=>JSON.stringify([path.resolve(x.from),x.to||'.']))).size);
for(const file of ['build/alder.ico','build/alder.icns','build/icons/256x256.png']) assert.ok(fs.existsSync(file),file);
console.log('Builder metadata, unique resource configuration and native icons verified.');

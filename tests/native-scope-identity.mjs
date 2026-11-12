/* global app, fixtureLeaf, fixtureStore, fixtureRelease -- Owned generated Obsidian fixture APIs. */
import {mkdtemp,copyFile,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stage=await mkdtemp(path.join(tmpdir(),'bases-pill-scope-build-'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const before=hash(await readFile(path.join(root,'main.js')));
process.env.BPC_BUILD_DIR=stage;process.env.OBSIDIAN_EXECUTABLE='/Applications/Obsidian.app/Contents/MacOS/Obsidian';process.env.OBSIDIAN_ASAR='/Users/gabriel/Library/Application Support/obsidian/obsidian-1.15.0.asar';
const args=process.argv;process.argv=[process.execPath,path.join(root,'esbuild.config.mjs'),'production'];
// eslint-disable-next-line no-unsanitized/method -- Fixed owned build script resolved from this fixture file.
await import(pathToFileURL(path.join(root,'esbuild.config.mjs')).href);process.argv=args;
for(const name of ['manifest.json','styles.css'])await copyFile(path.join(root,name),path.join(stage,name));
const {launchObsidian}=await import('./obsidian-harness.mjs');process.chdir(stage);
let runtime;
try{
 runtime=await launchObsidian({files:{'Original.base':'views:\n  - type: table\n    name: Original\n    order: [file.name]\n','Next.base':'views:\n  - type: table\n    name: Next\n    order: [file.name]\n'}});
 const page=runtime.page;
 await page.evaluate(async()=>{window.fixtureLeaf=app.workspace.getLeaf();await fixtureLeaf.openFile(app.vault.getAbstractFileByPath('Original.base'));});
 await page.locator('.bases-view').waitFor();
 const untouched=await page.evaluate(()=>app.vault.cachedRead(app.vault.getAbstractFileByPath('Next.base')));
 await page.evaluate(()=>{
  window.fixtureStore=app.plugins.getPlugin('bases-pill-colors').baseStores.forScope(fixtureLeaf.view.containerEl.querySelector('.bases-view'));
  const process=app.vault.process.bind(app.vault),gate=new Promise(resolve=>{window.fixtureRelease=resolve;});
  app.vault.process=async(file,update)=>{if(file.path==='Original.base')await gate;return process(file,update);};
  fixtureStore.setPropertyStyle('note.status','solid');void fixtureStore.flush();
 });
 await page.evaluate(async()=>{await fixtureLeaf.openFile(app.vault.getAbstractFileByPath('Next.base'));});
 await page.waitForFunction(()=>fixtureLeaf.view.file?.path==='Next.base');
 await page.locator('.bases-view').waitFor();
 const current=await page.evaluate(()=>{
  const store=app.plugins.getPlugin('bases-pill-colors').baseStores.forScope(fixtureLeaf.view.containerEl.querySelector('.bases-view'));
  const result={sameLeaf:app.workspace.getLeavesOfType('bases').includes(fixtureLeaf),distinctStore:store!==fixtureStore,currentStyle:store.getExplicitPropertyStrategy('note.status')??null};fixtureRelease();return result;
 });
 assert(current.sameLeaf);assert(current.distinctStore);assert.equal(current.currentStyle,null);
 await page.evaluate(()=>fixtureStore.flush());
 const after=await page.evaluate(async()=>({original:await app.vault.cachedRead(app.vault.getAbstractFileByPath('Original.base')),next:await app.vault.cachedRead(app.vault.getAbstractFileByPath('Next.base'))}));
 assert.equal(after.next,untouched);assert(after.original.includes('solid'));
 const report={sameNativeLeaf:true,distinctStores:true,queuedWriteStayedInOriginalBase:true,nextBaseBytesUnchanged:true,errors:runtime.errors,sourceBundleUnchanged:hash(await readFile(path.join(root,'main.js')))===before};
 await writeFile(path.join(stage,'native-scope-results.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify({stage,report})+'\n');
}finally{await runtime?.close();process.chdir(root);assert.equal(hash(await readFile(path.join(root,'main.js'))),before);}

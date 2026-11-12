const log = (...values) => process.stdout.write(values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ') + '\n');
/* global app, fixtureOpened, fixtureRuleModule, fixtureRuleView -- Generated native test-host APIs. */
import {build} from 'esbuild';
import {verifyPanels} from './native-panels.mjs';
// Owned native acceptance: generated vault/profile, code-only ASAR, no personal data or installation.
import { mkdtemp, copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(path.join(tmpdir(), 'bases-pill-build-'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const originalBundle = digest(await readFile(path.join(root, 'main.js')));
process.env.BPC_BUILD_DIR = stage;
process.env.OBSIDIAN_EXECUTABLE = '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
process.env.OBSIDIAN_ASAR = '/Users/gabriel/Library/Application Support/obsidian/obsidian-1.15.0.asar';
delete process.env.OBSIDIAN_THEME_DIR; delete process.env.FOLDER_TOOLKIT_TEST_VISIBLE;
process.chdir(root);
const savedArguments = process.argv; process.argv = [process.execPath, path.join(root,'esbuild.config.mjs'),'production'];
// eslint-disable-next-line no-unsanitized/method -- Fixed owned repository build script, no user-controlled input.
await import(pathToFileURL(path.join(root,'esbuild.config.mjs')).href); process.argv = savedArguments;
for (const name of ['manifest.json','styles.css']) await copyFile(path.join(root,name),path.join(stage,name));
assert.equal(digest(await readFile(path.join(root,'main.js'))), originalBundle, 'Source bundle changed');
const {launchObsidian} = await import('./obsidian-harness.mjs');
process.chdir(stage);
const ruleModule = await build({entryPoints:[path.join(root,'tests/native-rule-fixture.ts')],bundle:true,write:false,platform:'browser',format:'cjs',target:'es2021',plugins:[{name:'fixture-sdk',setup(build){build.onResolve({filter:/^obsidian$/},()=>({path:path.join(root,'tests/obsidian.ts')}));}}]});
const ruleCode = ruleModule.outputFiles[0].text;
const files = {
 '.fixture-code/rule.cjs': ruleCode,
 'Fixture.base': 'filters: file.inFolder("Records")\nviews:\n  - type: table\n    name: Generated\n    order: [file.name, note.status, note.links]\n',
 'Records/one.md': '---\nstatus: [Todo]\nlinks: "Generated https://example.invalid/one next words"\n---\nGenerated note.\n',
 'Records/two.md': '---\nstatus: [Done]\nlinks: "Generated https://example.invalid/two next words"\n---\nGenerated note.\n',
 '.obsidian/types.json': JSON.stringify({types:{status:'multitext',links:'text'}}),
};
let runtime;
try {
 runtime = await launchObsidian({files,pluginFolder:'bases-pill-colors'});
 const page = runtime.page;
 assert.deepEqual(await page.evaluate(()=>Array.from(app.plugins.enabledPlugins)),['bases-pill-colors']);
 await page.evaluate(async()=>{const leaf=app.workspace.getLeaf();await leaf.openFile(app.vault.getAbstractFileByPath('Fixture.base'));});
 await page.locator('.bases-view').waitFor();
 await page.evaluate(()=>{window.fixtureOpened=[];app.plugins.getPlugin('bases-pill-colors').enhancer.textLinks.open=url=>fixtureOpened.push(url);});
 await page.waitForFunction(()=>app.plugins.getPlugin('bases-pill-colors').enhancer.textLinks.rangesByText.size>0);
 const originalDoc=await page.evaluate(()=>({url:document.URL,views:app.workspace.getLeavesOfType('bases').length}));
 assert.equal(originalDoc.views,1);
 const popupPromise=page.context().waitForEvent('page');
 await page.evaluate(async()=>{const leaf=app.workspace.openPopoutLeaf();await leaf.openFile(app.vault.getAbstractFileByPath('Fixture.base'));});
 const popup=await popupPromise;
 const popupSession=await page.context().newCDPSession(popup);await popupSession.send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await popup.locator('.bases-view').waitFor();
 await page.waitForFunction(()=>Array.from(app.plugins.getPlugin('bases-pill-colors').enhancer.textLinks.roots.keys()).some(root=>root.ownerDocument!==document));
 await page.waitForFunction(()=>Array.from(app.plugins.getPlugin('bases-pill-colors').enhancer.textLinks.rangesByText).some(([text,ranges])=>text.ownerDocument!==document&&ranges.some(range=>range.getClientRects().length>0)),undefined,{timeout:20000});
 const point=await page.evaluate(()=>{
  const links=app.plugins.getPlugin('bases-pill-colors').enhancer.textLinks;
  for(const [text,ranges] of links.rangesByText)if(text.ownerDocument!==document&&ranges.length){
   const rect=ranges[0].getClientRects()[0];if(!rect)continue;
   const NodeClass=text.ownerDocument.defaultView.Node;
   return {x:rect.left+Math.min(8,rect.width/2),y:rect.top+rect.height/2,crossRealm:!(text instanceof Node)&&text instanceof NodeClass,ownerWindowDifferent:text.ownerDocument.defaultView!==window,ownerConstructorDifferent:NodeClass!==Node,globalInstance:text instanceof Node,ownerInstance:text instanceof NodeClass,url:ranges[0].toString()};
  }
  throw new Error('No owned popout URL range');
 });
 log('Native popout Node ownership',JSON.stringify(point));
 assert(point.ownerWindowDifferent,'Popout did not have its own document window');
 await popup.mouse.move(point.x,point.y);
 await popup.locator('.bpc-text-url-hover').waitFor();
 await popup.mouse.click(point.x,point.y);
 await page.waitForFunction(()=>fixtureOpened.length===1);
 assert((await page.evaluate(()=>fixtureOpened[0])).startsWith('https://example.invalid/'));
 // Focus must suspend URL navigation in this same secondary document.
 await popup.evaluate(url=>{const text=Array.from(document.querySelectorAll('.metadata-input-longtext')).find(element=>element.textContent.includes(url));if(!text)throw new Error('Owned URL text not found');text.tabIndex=0;text.focus();},point.url);
 await popup.mouse.click(point.x,point.y);
 assert.equal(await page.evaluate(()=>fixtureOpened.length),1);
 assert.equal(await page.evaluate(()=>app.workspace.getLeavesOfType('bases').length),2);
 // Native filesystem collision fixture uses the normal plugin's generated helper.
 await page.evaluate(async()=>{
  await app.vault.create(`Records/${'界'.repeat(84)}.md`,'---\nstatus: [Todo]\n---\nGenerated collision.');
  await app.vault.create(`Records/${'界'.repeat(83)} 2.md`,'---\nstatus: [Todo]\n---\nGenerated collision.');
 });
 const nameCell=page.locator('.bases-td[data-property="file.name"]').filter({has:page.locator('.internal-link',{hasText:'one'})}).first();
 await nameCell.waitFor();const nameBox=await nameCell.boundingBox();assert(nameBox);
 await nameCell.click({position:{x:nameBox.width-4,y:Math.min(12,nameBox.height/2)}});
 const editor=page.locator('.bpc-file-rename-input');await editor.waitFor();await editor.fill('界'.repeat(120)+'😀');await editor.press('Enter');
 await page.waitForFunction(()=>Boolean(app.vault.getAbstractFileByPath(`Records/${'界'.repeat(83)} 3.md`)));
 const nativeName=await page.evaluate(()=>app.vault.getAbstractFileByPath(`Records/${'界'.repeat(83)} 3.md`).name);
 assert(Buffer.byteLength(nativeName,'utf8')<=255);

 const loadedRuleCode=await page.evaluate(()=>app.vault.adapter.read('.fixture-code/rule.cjs'));
 assert.equal(digest(Buffer.from(loadedRuleCode)),digest(Buffer.from(ruleCode)));
 const panels=await verifyPanels(page,loadedRuleCode);
 await page.screenshot({path:path.join(stage,"native-base.png")});
 const report={nativePopout:true,crossRealmNode:point.crossRealm,ownerConstructorMatch:point.ownerInstance,ownerWindowDifferent:point.ownerWindowDifferent,hover:true,click:true,editingSuspendsLinks:true,communityOwners:1,baseTabs:2,nativeFilenameBytes:Buffer.byteLength(nativeName,'utf8'),sourceBundleUnchanged:true,panelCases:panels.length,errors:runtime.errors};
 await writeFile(path.join(stage,'native-results.json'),JSON.stringify(report,null,2));
 log('PASS native popout',JSON.stringify(report));
} finally {
 await runtime?.close();
 assert.equal(digest(await readFile(path.join(root,'main.js'))),originalBundle,'Source bundle changed during native test');
 process.chdir(root);
}
log('Native build/evidence:',stage);

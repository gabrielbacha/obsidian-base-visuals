import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { App } from 'obsidian';
import { SettingsStore } from '../src/core/settings-store';
import { BaseVisualStoreRepository } from '../src/core/base-visual-store';
import { PillEnhancer } from '../src/core/pill-enhancer';
import { TextLinks } from '../src/core/text-links';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
interface LinkIndex { attach(root:HTMLElement):void; updateCell(cell:HTMLElement):void; forgetCell(cell:HTMLElement):void;dispose():void }
interface OldTypes { TextLinks:new(open:(url:string)=>void)=>LinkIndex;BaseVisualStoreRepository:typeof BaseVisualStoreRepository;PillEnhancer:typeof PillEnhancer }
async function baseline():Promise<OldTypes>{
 const compiled = execFileSync(process.execPath,["--input-type=module","-e",`import {build} from "esbuild";import path from "node:path";const root=${JSON.stringify(root)};const result=await build({stdin:{contents:"export {TextLinks} from './tests/baseline/text-links';export {BaseVisualStoreRepository} from './tests/baseline/base-visual-store';export {PillEnhancer} from './tests/baseline/pill-enhancer';",resolveDir:root},bundle:true,write:false,format:'iife',globalName:'Baseline',platform:'browser',plugins:[{name:'baseline-dependencies',setup(build){build.onResolve({filter:/^obsidian$/},()=>({path:path.join(root,'tests/obsidian.ts')}));build.onResolve({filter:/.*/},args=>args.path.startsWith('.')&&args.importer.includes('/tests/baseline/')?{path:path.resolve(root,'src/core',args.path)+'.ts'}:undefined);}}]});
console.log(result.outputFiles[0].text);`],{cwd:root,encoding:"utf8"});
 // Only immutable, reviewed source snapshots from this repository execute here. No model/network input.
 // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Executes immutable reviewed baseline code only, never external input.
 const load=new Function(compiled+';return Baseline;') as () => OldTypes;return load();
}
it('measures identical URL refresh and bulk-removal workloads before and after indexing',async()=>{
 const before=await baseline(),observations=[];
 for(const count of [500,1000,2000])for(const [variant,Constructor]of [['before',before.TextLinks],['after',TextLinks]] as const){
  const scope=document.body.createDiv('bases-view'),links=new Constructor(()=>undefined);links.attach(scope);
  const cells=Array.from({length:count},(_,index)=>scope.createDiv({cls:'bases-td',attr:{'data-property':'note.links'}}));
  for(const [index,cell]of cells.entries())cell.createDiv({cls:'metadata-input-longtext',text:`Generated https://example.invalid/${index}`});
  for(const cell of cells)links.updateCell(cell);
  let checks=0;for(const cell of cells){const original=cell.contains.bind(cell);cell.contains=node=>{checks++;return original(node);};}
  const start=performance.now();for(const cell of cells)links.updateCell(cell);const refreshMs=performance.now()-start,refreshChecks=checks;
  checks=0;const removal=performance.now();for(const cell of cells)links.forgetCell(cell);const removalMs=performance.now()-removal;
  observations.push({variant,cells:count,refreshChecks,removalChecks:checks,refreshMs,removalMs});
  if(variant==='after'){expect(refreshChecks).toBeLessThanOrEqual(count);expect(checks).toBeLessThanOrEqual(count);}else expect(refreshChecks).toBe(count*(count-1));links.dispose();scope.remove();
 }
 process.stdout.write('Measured URL-index before/after '+JSON.stringify(observations)+'\n');
},30000);
it('counts and times one production-path edit with two views and an unrelated Base',async()=>{
 const before=await baseline(),observations=[];
 for(const [variant,Repository,Enhancer]of [['before',before.BaseVisualStoreRepository,before.PillEnhancer],['after',BaseVisualStoreRepository,PillEnhancer]] as const){
  const scopes=Array.from({length:3},()=>document.body.createDiv('bases-view'));
  const configs=scopes.map(()=>{const data=new Map<string,unknown>();return{get:(key:string)=>data.get(key),set:(key:string,value:unknown)=>data.set(key,value),getOrder:()=>['note.status','note.owner']};});
  const tables=scopes.map((scope,index)=>({type:'table',containerEl:scope,path:`generated-${index<2?0:index}.base`,config:configs[index],data:{properties:['note.status','note.owner'],data:[]}}));
  for(const scope of scopes){const table=scope.createDiv('bases-table-container');for(let i=0;i<100;i++){const row=table.createDiv('bases-tr');for(const property of ['note.status','note.owner'])row.createDiv({cls:'bases-td',attr:{'data-property':property}}).createDiv({cls:'metadata-input-longtext',text:'Generated text'});}}
  const sources=new Map(tables.map(table=>[table.path,JSON.stringify({views:[{type:'table',name:'Generated'}]})]));
  const app={workspace:{on:()=>({}),getLeavesOfType:(type:string)=>type==='bases'?scopes.map((scope,index)=>({view:{containerEl:scope,nativeTable:tables[index]}})):[]},vault:{getFileByPath:(file:string)=>({path:file,extension:'base'}),cachedRead:async(file:{path:string})=>sources.get(file.path)??'{}',process:async(file:{path:string},update:(value:string)=>string)=>sources.set(file.path,update(sources.get(file.path)??'{}'))}} as unknown as App;
  const global=new SettingsStore(SettingsStore.normalize(null),async()=>undefined),repo=new Repository(app,global),enhancer=new Enhancer(app,global,()=>undefined,()=>undefined,scope=>repo.forScope(scope),repo);
  const counts={cells:0,rows:0,unrelatedCells:0};const methods=enhancer as unknown as {processCell(cell:HTMLElement):void;processRow(row:HTMLElement):void};
  const cell=methods.processCell.bind(enhancer),row=methods.processRow.bind(enhancer);methods.processCell=value=>{counts.cells++;if(scopes[2]?.contains(value))counts.unrelatedCells++;cell(value);};methods.processRow=value=>{counts.rows++;row(value);};
  enhancer.start(()=>undefined);await new Promise(resolve=>setTimeout(resolve,0));counts.cells=counts.rows=counts.unrelatedCells=0;
  const store=repo.forScope(scopes[0] as HTMLElement),start=performance.now();store.setPropertyStyle('note.status','solid');await store.flush();const elapsedMs=performance.now()-start;
  observations.push({variant,views:3,rowsPerView:100,cellsPerView:200,...counts,elapsedMs});if(variant==='after'){expect(counts.unrelatedCells).toBe(0);expect(counts.cells).toBeLessThanOrEqual(400);}else expect(counts.unrelatedCells).toBeGreaterThan(0);
  enhancer.stop();await repo.dispose();await global.dispose();for(const scope of scopes)scope.remove();
 }
 process.stdout.write('Measured production notification before/after '+JSON.stringify(observations)+'\n');
},30000);

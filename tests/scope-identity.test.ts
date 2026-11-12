import { expect, it } from 'vitest';
import type { App } from 'obsidian';
import { parseYaml } from 'obsidian';
import { STUDIO_KEY, readStudioBase, readStudioView, studioStrategies, studioViewAppearances } from '@gabrielbacha/bases-contract';
import { BaseVisualStoreRepository } from '../src/core/base-visual-store';
import { SettingsStore } from '../src/core/settings-store';

it.each(['base', 'view'])('retains the original %s target when a native pane and config are reused during a write', async kind => {
 const root=document.body.createDiv(), scope=root.createDiv('bases-view');
 const files=[{path:'original.base',extension:'base'},{path:'next.base',extension:'base'}];
 const sources=new Map(files.map(file=>[file.path,JSON.stringify({views:[{type:'table',name:'Original'},{type:'table',name:'Next'}]})]));
 const values=new Map<string,unknown>([['type','table'],['name','Original']]);
 const config={get:(key:string)=>values.get(key),set:(key:string,value:unknown)=>values.set(key,value)};
 const table={type:'table',containerEl:scope,path:files[0]!.path,config};
 let finish:()=>void=()=>undefined, started:()=>void=()=>undefined;
 const gate=new Promise<void>(resolve=>{finish=resolve;}), entered=new Promise<void>(resolve=>{started=resolve;});
 const app={workspace:{getLeavesOfType:(type:string)=>type==='bases'?[{view:{containerEl:root,nativeTable:table}}]:[]},vault:{getFileByPath:(path:string)=>files.find(file=>file.path===path),cachedRead:async(file:{path:string})=>sources.get(file.path),process:async(file:{path:string},update:(source:string)=>string)=>{started();await gate;sources.set(file.path,update(sources.get(file.path)!));}}} as unknown as App;
 const global=new SettingsStore(SettingsStore.normalize(null),async()=>undefined),repo=new BaseVisualStoreRepository(app,global);
 const old=repo.forScope(scope);await new Promise(resolve=>setTimeout(resolve,0));
 old.setPropertyStyle('note.status','solid');
 const saving=old.flush();await entered;
 table.path=kind==='base'?files[1]!.path:files[0]!.path;values.set('name','Next');values.delete(STUDIO_KEY);
 const next=repo.forScope(scope);expect(next).not.toBe(old);
 expect(next.getExplicitPropertyStrategy('note.status')).toBeUndefined();
 finish();await saving;await new Promise(resolve=>setTimeout(resolve,0));
 const original=parseYaml(sources.get(files[0]!.path)!) as {views:unknown[]};
 expect(studioStrategies(readStudioBase(original))['note.status']?.style).toBe('solid');
 expect(readStudioBase(parseYaml(sources.get(files[1]!.path)!))).toEqual({});
 expect(readStudioView(original.views[1])).toEqual({});
 expect(next.getExplicitPropertyStrategy('note.status')).toEqual(kind==='base'?undefined:old.getExplicitPropertyStrategy('note.status'));
 await repo.dispose();await global.dispose();root.remove();
});

it('saves a delayed view appearance to its captured view rather than a newly selected view',async()=>{
 const root=document.body.createDiv(),scope=root.createDiv('bases-view');
 const file={path:'generated.base',extension:'base'};let source=JSON.stringify({views:[{type:'table',name:'Original'},{type:'table',name:'Next'}]});
 const values=new Map<string,unknown>([['name','Original'],['type','table']]);const config={get:(key:string)=>values.get(key),set:(key:string,value:unknown)=>values.set(key,value)};
 let finish:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{finish=resolve;});
 const app={workspace:{getLeavesOfType:(type:string)=>type==='bases'?[{view:{containerEl:root,nativeTable:{type:'table',containerEl:scope,path:file.path,config}}}]:[]},vault:{getFileByPath:()=>file,cachedRead:async()=>source,process:async(_file:unknown,update:(source:string)=>string)=>{await gate;source=update(source);}}} as unknown as App;
 const global=new SettingsStore(SettingsStore.normalize(null),async()=>undefined),repo=new BaseVisualStoreRepository(app,global);
 repo.forScope(scope);await new Promise(resolve=>setTimeout(resolve,0));
 repo.setViewColumnAppearance(scope,'note.status',{bold:true});
 values.set('name','Next');repo.forScope(scope);finish();await new Promise(resolve=>setTimeout(resolve,0));
 const parsed=parseYaml(source) as {views:unknown[]};
 expect(studioViewAppearances(readStudioView(parsed.views[0]))).toHaveProperty('note.status');
 expect(readStudioView(parsed.views[1])).toEqual({});
 await repo.dispose();await global.dispose();root.remove();
});

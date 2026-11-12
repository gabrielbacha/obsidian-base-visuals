import { afterEach, expect, it, vi } from 'vitest';
import type { App, EventRef } from 'obsidian';
import { BaseVisualStoreRepository } from '../src/core/base-visual-store';
import { SettingsStore } from '../src/core/settings-store';
import { PillEnhancer } from '../src/core/pill-enhancer';
import { TextLinks } from '../src/core/text-links';

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of disposals.splice(0)) await close(); document.body.replaceChildren(); });
function fixture(count: number) {
	const scopes = Array.from({length: count}, () => document.body.createDiv('bases-view'));
	const files = scopes.map((_, index) => ({path:`generated-${index < 2 ? 0 : index}.base`,extension:'base'}));
	const configs = scopes.map(() => {const values=new Map<string,unknown>();return {get:(key:string)=>values.get(key),set:(key:string,value:unknown)=>values.set(key,value),getOrder:()=>['note.status']};});
	const sources = new Map(files.map(file=>[file.path,JSON.stringify({views:[{type:'table',name:'Generated'}]})]));
	const tables = scopes.map((scope,index)=>({type:'table',containerEl:scope,path:files[index]?.path,config:configs[index],data:{properties:['note.status'],data:[]}}));
	let leaves = scopes.map((scope,index)=>({view:{containerEl:scope,nativeTable:tables[index]}}));
	const read=vi.fn(async(file:{path:string})=>sources.get(file.path)??'{}');
	let gate: Promise<void> | undefined;
	const process=vi.fn(async(file:{path:string},update:(source:string)=>string)=>{await gate;sources.set(file.path,update(sources.get(file.path)??'{}'));});
	let modified: ((file:{path:string})=>void) | undefined;
	const app={workspace:{getLeavesOfType:(type:string)=>type==='bases'?leaves:[],on:()=>({})},vault:{getFileByPath:(path:string)=>files.find(file=>file.path===path)??null,cachedRead:read,process,on:(_name:string,callback:typeof modified)=>{modified=callback;return {};}}} as unknown as App;
	const global=new SettingsStore(SettingsStore.normalize(null),async()=>undefined);
	const repo=new BaseVisualStoreRepository(app,global);
	disposals.push(async()=>{await repo.dispose();await global.dispose();});
	return {scopes,files,repo,global,app,read,process,modified:()=>modified,setGate:(value:Promise<void>)=>{gate=value;},removeLeaves:()=>{leaves=[];}};
}
const settle=async()=>{await new Promise(resolve=>setTimeout(resolve,0));};
it('uses the production repository event path and leaves unrelated Bases untouched',async()=>{
	const f=fixture(3), stores=f.scopes.map(scope=>f.repo.forScope(scope));
	await settle();
	const events=stores.map(store=>vi.fn());stores.forEach((store,index)=>store.subscribe(events[index]??(()=>undefined)));
	const global=vi.fn();f.global.subscribe(global);
	const first=stores[0];expect(first).toBeDefined();first?.setPropertyStyle('note.status','solid');await first?.flush();
	expect(global).not.toHaveBeenCalled();expect(events[2]).not.toHaveBeenCalled();expect(events[0]?.mock.calls.filter(([change])=>change==='change').length).toBeLessThanOrEqual(1);expect(events[1]?.mock.calls.filter(([change])=>change==='change').length).toBeLessThanOrEqual(1);
});
it('releases closed views and ignores later file hydration, including a pending save',async()=>{
	const f=fixture(20);f.repo.watch(()=>undefined);const stores=f.scopes.map(scope=>f.repo.forScope(scope));await settle();
	expect(f.repo.liveStoreCount).toBe(20);
	let finish:()=>void=()=>undefined;f.setGate(new Promise<void>(resolve=>{finish=resolve;}));
	stores[0]?.setPropertyStyle('note.status','solid');const saving=stores[0]?.flush();await settle();
	const release=f.repo.releaseScope(f.scopes[0] as HTMLElement);let released=false;void release.then(()=>{released=true;});await settle();expect(released).toBe(false);finish();await saving;await release;
	for(const scope of f.scopes.slice(1))await f.repo.releaseScope(scope);
	expect(f.repo.liveStoreCount).toBe(0);expect(f.repo.groupCount).toBe(0);
	f.read.mockClear();f.modified()?.(f.files[0] as {path:string});await settle();expect(f.read).not.toHaveBeenCalled();
});
it('enhancer refreshes only cells and rows belonging to the notifying scoped store',async()=>{
	const f=fixture(3);for(const scope of f.scopes){const table=scope.createDiv('bases-table-container');const row=table.createDiv('bases-tr');row.createDiv({cls:'bases-td',attr:{'data-property':'note.status'}}).createDiv({cls:'metadata-input-longtext',text:'Generated'});}
	const enhancer=new PillEnhancer(f.app,f.global,()=>undefined,()=>undefined,scope=>f.repo.forScope(scope),f.repo);
	const calls=enhancer as unknown as {processCell(cell:HTMLElement):void;processRow(row:HTMLElement):void};
	const cells=vi.spyOn(calls,'processCell'),rows=vi.spyOn(calls,'processRow');enhancer.start(()=>({} as EventRef));await settle();cells.mockClear();rows.mockClear();
	const first=f.scopes[0] as HTMLElement;f.repo.forScope(first).setPropertyStyle('note.status','solid');await f.repo.forScope(first).flush();
	for(const [cell] of cells.mock.calls)expect(f.scopes[2]?.contains(cell)).toBe(false);
	for(const [row] of rows.mock.calls)expect(f.scopes[2]?.contains(row)).toBe(false);
	expect(cells.mock.calls.length).toBeLessThanOrEqual(2);expect(rows.mock.calls.length).toBeLessThanOrEqual(2);
	f.removeLeaves();enhancer.stop();await settle();expect(f.repo.liveStoreCount).toBe(0);
});
it('indexes URL text by cell with linear refresh/removal work at 500, 1000 and 2000 cells',()=>{
	const observations=[];
	for(const count of [500,1000,2000]){
		const root=document.body.createDiv('bases-view'),links=new TextLinks(()=>undefined);links.attach(root);
		const cells=Array.from({length:count},(_,index)=>root.createDiv({cls:'bases-td',attr:{'data-property':'note.links'}}));
		for(const [index,cell]of cells.entries())cell.createDiv({cls:'metadata-input-longtext',text:`Generated https://example.invalid/${index}`});
		for(const cell of cells)links.updateCell(cell);
		let checks=0;const contains=cells.map(cell=>vi.spyOn(cell,'contains').mockImplementation((node)=>{checks++;return Node.prototype.contains.call(cell,node);}));
		for(const cell of cells)links.updateCell(cell);
		expect(checks).toBeLessThanOrEqual(count);
		checks=0;const first=cells[0] as HTMLElement;const text=first.querySelector('.metadata-input-longtext');if(text)text.textContent='Updated https://example.invalid/new';links.updateCell(first);expect(checks).toBeLessThanOrEqual(1);
		for(const cell of cells)links.forgetCell(cell);expect(checks).toBeLessThanOrEqual(1);observations.push({cells:count,membershipChecks:checks});for(const spy of contains)spy.mockRestore();links.dispose();root.remove();
	}
	process.stdout.write('URL-index scaling '+JSON.stringify(observations)+'\n');
}, 15000);

it('retains a failed closed write and releases it after a successful retry',async()=>{
	const f=fixture(1),scope=f.scopes[0] as HTMLElement,store=f.repo.forScope(scope);await settle();
	const original=f.process.getMockImplementation();f.process.mockRejectedValue(new Error('Generated write failure'));
	store.setPropertyStyle('note.status','solid');await f.repo.releaseScope(scope);
	expect(store.isDirty).toBe(true);expect(f.repo.liveStoreCount).toBe(1);
	if(original)f.process.mockImplementation(original);
	await store.flush();await settle();expect(store.isDirty).toBe(false);expect(f.repo.liveStoreCount).toBe(0);expect(f.repo.groupCount).toBe(0);
});

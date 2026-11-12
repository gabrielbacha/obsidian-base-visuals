import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { findUnusedOptions } from '../src/core/unused-options';

describe('unused option cleanup', () => {
	it('finds undeclared saved values absent from every indexed note in the vault', () => {
		const scope = document.body.createDiv('bases-view');
		const list = (...items: string[]) => ({
			length: () => items.length,
			get: (index: number) => ({ toString: () => items[index] ?? '' }),
		});
		const entries = [
			{ getValue: (propertyId: string) => propertyId === 'note.capabilities'
				? list('1. Current', '2. Current') : { toString: () => '' } },
			{ getValue: (propertyId: string) => propertyId === 'note.status'
				? { toString: () => 'Done' } : list('3. Current') },
		];
		const nativeTable = {
			type: 'table', containerEl: scope,
			config: { get: () => undefined, set: () => undefined },
			data: { properties: ['note.capabilities', 'note.status'], data: entries },
		};
		const app = {
			workspace: { getLeavesOfType: () => [{ view: { containerEl: scope, nativeTable } }] },
			vault: { getMarkdownFiles: () => [{path:"generated-a.md"}, {path:"generated-b.md"}] },
			metadataCache: {getFileCache: (file: {path:string}) => ({frontmatter: file.path === "generated-a.md" ? {capabilities:["1. Current", "2. Current"],status:"Done"} : {capabilities:["3. Current"]}})},
		} as unknown as App;
		const options = [
			{ propertyId: 'note.capabilities', value: '1. Current' },
			{ propertyId: 'note.capabilities', value: 'Deleted category' },
			{ propertyId: 'note.status', value: 'Done' },
		];
		const plan = findUnusedOptions(app, scope, options);
		expect(plan.options).toEqual([{ propertyId: 'note.capabilities', value: 'Deleted category' }]);
		expect(plan.removedProperties).toEqual([]);

	});

	it('does not claim anything is unused when native Base results are unavailable', () => {
		const scope = document.body.createDiv('bases-view');
		const app = {
			workspace: { getLeavesOfType: () => [] },
		} as unknown as App;
		const plan = findUnusedOptions(
			app,
			scope,
			[{ propertyId: 'note.deleted', value: 'Old' }],
			['note.deleted'],
		);
		expect(plan.options).toEqual([]);
		expect(plan.removedProperties).toEqual([]);
		expect(plan.verifiedProperties).toBe(0);
	});
});


it('retains colors from another filtered view, declared options and uncertain properties', () => {
	const scope = document.body.createDiv('bases-view');
	const app = {vault:{getMarkdownFiles:()=>[{path:'visible.md'},{path:'hidden.md'}]},metadataCache:{getFileCache:(file:{path:string})=>({frontmatter:{status:file.path==='visible.md'?'Todo':'Done'}})}} as unknown as App;
	const options=[{propertyId:'note.status',value:'Done'},{propertyId:'note.status',value:'Declared'},{propertyId:'formula.status',value:'Unknown'}];
	const plan=findUnusedOptions(app,scope,options,['note.missing'],{'note.status':[{value:'Declared'}]});
	expect(plan.options).toEqual([]);expect(plan.removedProperties).toEqual([]);
});
it('does not remove anything while a note is unindexed', () => {
	const app={vault:{getMarkdownFiles:()=>[{path:'new.md'}]},metadataCache:{getFileCache:()=>null}} as unknown as App;
	expect(findUnusedOptions(app,document.body,[{propertyId:'note.status',value:'Done'}]).verifiedProperties).toBe(0);
});

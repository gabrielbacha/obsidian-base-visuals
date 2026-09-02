import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { findUnusedOptions } from '../src/core/unused-options';

describe('unused option cleanup', () => {
	it('finds saved values missing from the current Base result set', () => {
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

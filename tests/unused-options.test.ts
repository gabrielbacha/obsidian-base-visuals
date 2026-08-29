import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { findUnusedOptions } from '../src/core/unused-options';

describe('unused option cleanup', () => {
	it('finds saved note-list values that no longer exist without modifying notes', () => {
		const first = { path: 'one.md' };
		const second = { path: 'two.md' };
		const frontmatter = new Map<object, Record<string, unknown>>([
			[first, { capabilities: ['1. Current', '2. Current'] }],
			[second, { capabilities: ['3. Current'], status: 'Done' }],
		]);
		const app = {
			vault: { getMarkdownFiles: () => [first, second] },
			metadataCache: { getFileCache: (file: object) => ({ frontmatter: frontmatter.get(file) }) },
			workspace: { getLeavesOfType: () => [] },
		} as unknown as App;
		const options = [
			{ propertyId: 'note.capabilities', value: '1. Current' },
			{ propertyId: 'note.capabilities', value: 'Deleted category' },
			{ propertyId: 'note.status', value: 'Done' },
		];
		const plan = findUnusedOptions(app, document.body, options);
		expect(plan.options).toEqual([{ propertyId: 'note.capabilities', value: 'Deleted category' }]);
		expect(plan.removedProperties).toEqual([]);
		expect(frontmatter.get(first)?.capabilities).toEqual(['1. Current', '2. Current']);
	});

	it('marks a property as removed when no note defines it anymore', () => {
		const file = { path: 'one.md' };
		const app = {
			vault: { getMarkdownFiles: () => [file] },
			metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
			workspace: { getLeavesOfType: () => [] },
		} as unknown as App;
		const plan = findUnusedOptions(
			app,
			document.body,
			[{ propertyId: 'note.deleted', value: 'Old' }],
			['note.deleted'],
		);
		expect(plan.removedProperties).toEqual(['note.deleted']);
	});
});

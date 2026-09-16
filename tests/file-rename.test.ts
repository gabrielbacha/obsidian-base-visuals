import { TFile, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { renameFileBasename, resolveFileFromNameCell } from '../src/core/file-rename';

describe('inline file rename', () => {
	it('resolves the backing file from the rendered Base filename link', () => {
		const scope = document.body.createDiv('bases-view');
		const cell = scope.createDiv('bases-td');
		const link = cell.createEl('a');
		link.dataset.href = 'Projects/Baby%20plan';
		const file = createFile('Projects/Baby plan.md');
		const getFirstLinkpathDest = vi.fn(() => file);
		const app = { metadataCache: { getFirstLinkpathDest }, workspace: {
			getLeavesOfType: () => [],
		} } as unknown as App;

		expect(resolveFileFromNameCell(app, scope, cell)).toBe(file);
		expect(getFirstLinkpathDest).toHaveBeenCalledWith('Projects/Baby plan', '');
	});

	it('resolves the backing file from native Base row data when the rendered link cannot resolve', () => {
		const scope = document.body.createDiv('bases-view');
		const table = scope.createDiv('bases-table-container');
		const row = table.createDiv('bases-tr');
		const cell = row.createDiv('bases-td');
		const link = cell.createEl('a', { text: 'Baby plan' });
		link.href = 'app://obsidian.md/Vault/Projects/Baby%20plan.md';
		const file = createFile('Projects/Baby plan.md');
		const nativeTable = {
			type: 'table',
			containerEl: table,
			config: { get: vi.fn(), set: vi.fn() },
			data: { data: [{ file, getValue: vi.fn() }] },
		};
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases'
				? [{ view: { containerEl: scope, nativeTable } }]
				: [] },
			metadataCache: { getFirstLinkpathDest: vi.fn(() => null) },
		} as unknown as App;

		expect(resolveFileFromNameCell(app, scope, cell)).toBe(file);
	});

	it('renames only the basename while preserving folder and extension', async () => {
		const file = createFile('Projects/Old name.md');
		const renameFile = vi.fn(async () => undefined);
		const app = {
			vault: { getAbstractFileByPath: vi.fn(() => null) },
			fileManager: { renameFile },
		} as unknown as App;

		await expect(renameFileBasename(app, file, ' New name.md ')).resolves.toBe('renamed');
		expect(renameFile).toHaveBeenCalledWith(file, 'Projects/New name.md');
	});

	it('rejects empty, path-changing, and duplicate names', async () => {
		const file = createFile('Projects/Old name.md');
		const duplicate = createFile('Projects/Existing.md');
		const app = {
			vault: { getAbstractFileByPath: (path: string) => path.endsWith('Existing.md') ? duplicate : null },
			fileManager: { renameFile: vi.fn() },
		} as unknown as App;

		await expect(renameFileBasename(app, file, ' ')).rejects.toThrow('cannot be empty');
		await expect(renameFileBasename(app, file, '../Moved')).rejects.toThrow('path separators');
		await expect(renameFileBasename(app, file, 'Existing')).rejects.toThrow('already exists');
	});

	it('does not invoke Obsidian for an unchanged name', async () => {
		const file = createFile('Projects/Same.md');
		const renameFile = vi.fn();
		const app = {
			vault: { getAbstractFileByPath: vi.fn() },
			fileManager: { renameFile },
		} as unknown as App;

		await expect(renameFileBasename(app, file, 'Same')).resolves.toBe('unchanged');
		expect(renameFile).not.toHaveBeenCalled();
	});
});

function createFile(path: string): TFile {
	const name = path.split('/').at(-1) ?? path;
	const extension = name.includes('.') ? name.split('.').at(-1) ?? '' : '';
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	return Object.assign(new TFile(), {
		path,
		name,
		basename,
		extension,
		parent: { path: parentPath },
	});
}

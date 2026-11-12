import type { App, WorkspaceLeaf } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import {
	applyNativeColumnWidthPreset,
	canCreateNativeFileForGroup,
	createNativeFileForGroup,
	findNativeTableView,
	forgetNativeTableViewMisses,
	getNativeColumnAppearance,
	getNativeGroupProperty,
	getNativePropertyKind,
	getNativeUnsetColumnProperties,
	getNativeMainProperty,
	getNativeRowHeight,
	resolveNativePropertyId,
	resetNativeColumnWidths,
	setNativeRowHeight,
} from '../src/core/native-table-view';

describe('native table view bridge', () => {
	it('uses Obsidian native view config for row height and the main column', () => {
		const root = document.body.createDiv('workspace-leaf-content');
		const table = root.createDiv('bases-table-container');
		const values = new Map<string, unknown>([
			['rowHeight', 'tall'],
			['columnSize', { 'file.name': 240 }],
		]);
		const set = vi.fn((key: string, value: unknown) => values.set(key, value));
		const nativeTable = {
			type: 'table',
			containerEl: table,
			config: {
				groupBy: { property: 'note.category' },
				get: (key: string) => values.get(key),
				set,
				getOrder: () => ['file.name', 'note.status'],
			},
		};
		const leaf = { view: { containerEl: root, renderer: { child: nativeTable } } };
		const app = appWithLeaves([leaf as unknown as WorkspaceLeaf]);

		expect(getNativeRowHeight(app, root)).toBe('tall');
		expect(getNativeMainProperty(app, root)).toBe('file.name');
		expect(getNativeGroupProperty(app, root)).toBe('note.category');
		expect(setNativeRowHeight(app, root, 'medium')).toBe(true);
		expect(set).toHaveBeenCalledWith('rowHeight', 'medium');
	});

	it('stores validated column appearance in the current native view', () => {
		const root = document.body.createDiv();
		const values = new Map<string, unknown>([
			['basesVisualsColumnAppearance', {
				'note.status': { tone: 'muted', bold: true },
				'note.invalid': { tone: 'custom', color: 'not-a-color' },
			}],
		]);
		const set = vi.fn((key: string, value: unknown) => values.set(key, value));
		const nativeTable = {
			type: 'table',
			containerEl: root,
			config: { get: (key: string) => values.get(key), set },
		};
		const leaf = { view: { containerEl: root, nativeTable } };
		const app = appWithLeaves([leaf as unknown as WorkspaceLeaf]);

		expect(getNativeColumnAppearance(app, root, 'note.status')).toEqual({
			tone: 'muted', bold: true,
		});
		expect(getNativeColumnAppearance(app, root, 'note.invalid')).toEqual({
			tone: 'default', bold: false,
		});
		// A view's own entry wins over the Base's; the Base's shows where the view has none.
		const base = { 'note.status': { tone: 'faint' }, 'note.cost': { tone: 'custom', color: '#abc', bold: true } };
		expect(getNativeColumnAppearance(app, root, 'note.status', base)).toEqual({ tone: 'muted', bold: true });
		expect(getNativeColumnAppearance(app, root, 'note.cost', base)).toEqual({
			tone: 'custom', bold: true, color: '#AABBCC',
		});
		// The older key is only read: nothing writes it back.
		expect(set).not.toHaveBeenCalled();
	});

	it('resolves a displayed column alias to the evaluator property id', () => {
		const root = document.body.createDiv('workspace-leaf-content');
		const table = root.createDiv('bases-table-container');
		const head = table.createDiv('bases-thead');
		const header = head.createDiv('bases-td');
		header.dataset.property = 'Status';
		const body = table.createDiv('bases-tbody');
		const row = body.createDiv('bases-tr');
		const cell = row.createDiv('bases-td');
		cell.dataset.property = 'Status';
		const nativeTable = {
			type: 'table',
			containerEl: table,
			config: {
				get: vi.fn(), set: vi.fn(), getOrder: () => ['Status'],
				getDisplayName: (propertyId: string) => propertyId === 'note.status_todo' ? 'Status' : propertyId,
			},
			data: { properties: ['note.status_todo'], data: [] },
			header: { cells: [{ prop: 'Status', el: header }] },
		};
		const leaf = { view: { containerEl: root, nativeTable } };
		const app = appWithLeaves([leaf as unknown as WorkspaceLeaf]);

		expect(resolveNativePropertyId(app, root, header)).toBe('note.status_todo');
		expect(resolveNativePropertyId(app, root, cell)).toBe('note.status_todo');
		expect(resolveNativePropertyId(app, root, 'Status')).toBe('note.status_todo');
	});

	it('resolves case and note-prefix variants without requiring a configured display name', () => {
		const root = document.body.createDiv('workspace-leaf-content');
		const table = root.createDiv('bases-table-container');
		const head = table.createDiv('bases-thead');
		const header = head.createDiv('bases-td');
		header.dataset.property = 'Status';
		const body = table.createDiv('bases-tbody');
		const row = body.createDiv('bases-tr');
		const cell = row.createDiv('bases-td');
		cell.dataset.property = 'Status';
		cell.createDiv('multi-select-pill');
		const nativeTable = {
			type: 'table', containerEl: table,
			config: { get: vi.fn(), set: vi.fn(), getOrder: () => ['Status'] },
			data: { properties: ['note.status_todo'], data: [] },
			header: { cells: [{ prop: 'Status', el: header }] },
		};
		const leaf = { view: { containerEl: root, nativeTable } };
		const app = appWithLeaves([leaf as unknown as WorkspaceLeaf]);

		expect(resolveNativePropertyId(app, root, 'Status')).toBe('note.status_todo');
		expect(resolveNativePropertyId(app, root, cell)).toBe('note.status_todo');
		expect(getNativePropertyKind(app, root, 'note.status_todo')).toBe('list');
	});

	it('maps missing and malformed row heights to Short', () => {
		const root = document.body.createDiv();
		const nativeTable = {
			type: 'table',
			containerEl: root,
			config: { get: () => 'giant', set: vi.fn() },
		};
		const leaf = { view: { containerEl: root, nativeTable } };
		expect(getNativeRowHeight(appWithLeaves([leaf as unknown as WorkspaceLeaf]), root)).toBe('');
	});

	it('applies width presets to all columns or only columns without a set width', () => {
		const root = document.body.createDiv();
		const set = vi.fn();
		const columnInfo = {
			'file.name': { headerWidth: 80, contentWidth: 120, customWidth: 210 },
			'note.status': { headerWidth: 70, contentWidth: 90, customWidth: 0 },
		};
		const updateVirtualDisplay = vi.fn();
		const nativeTable = {
			type: 'table',
			containerEl: root,
			config: { get: vi.fn(), set },
			data: { properties: ['file.name', 'note.status'] },
			columnInfo,
			minColWidth: 40,
			maxColWidth: 300,
			updateVirtualDisplay,
		};
		const leaf = { view: { containerEl: root, nativeTable } };
		const app = appWithLeaves([leaf as unknown as WorkspaceLeaf]);

		expect(applyNativeColumnWidthPreset(app, root, 100, 'unset')).toBe(true);
		expect(columnInfo['file.name'].customWidth).toBe(210);
		expect(columnInfo['note.status'].customWidth).toBe(100);
		expect(getNativeUnsetColumnProperties(app, root, 100)).toEqual(['note.status']);
		expect(applyNativeColumnWidthPreset(
			app,
			root,
			160,
			'unset',
			new Set(getNativeUnsetColumnProperties(app, root, 100)),
		)).toBe(true);
		expect(columnInfo['file.name'].customWidth).toBe(210);
		expect(columnInfo['note.status'].customWidth).toBe(160);
		columnInfo['note.status'].customWidth = 175;
		expect(getNativeUnsetColumnProperties(app, root, 160)).toEqual([]);
		expect(applyNativeColumnWidthPreset(app, root, 240, 'all')).toBe(true);
		expect(columnInfo['file.name'].customWidth).toBe(240);
		expect(columnInfo['note.status'].customWidth).toBe(240);
		expect(updateVirtualDisplay).toHaveBeenCalledTimes(3);

		expect(resetNativeColumnWidths(app, root)).toBe(true);
		expect(columnInfo['file.name'].customWidth).toBe(0);
		expect(columnInfo['note.status'].customWidth).toBe(0);
		expect(set).toHaveBeenLastCalledWith('columnSize', null);
	});
	it('creates a new view file with the clicked list group while preserving Base defaults', async () => {
		const root = document.body.createDiv('workspace-leaf-content');
		const table = root.createDiv('bases-table-container');
		const frontmatter: Record<string, unknown> = { tags: ['todo'], owner: 'Gabriel' };
		const createFileForView = vi.fn(async (
			_name?: string,
			processor?: (value: Record<string, unknown>) => void,
		) => processor?.(frontmatter));
		const listValue = { length: () => 1, get: () => 'Baby home preparation' };
		const nativeTable = {
			type: 'table',
			containerEl: table,
			config: { get: vi.fn(), set: vi.fn() },
			data: {
				properties: ['note.subcategory'],
				data: [{ getValue: (propertyId: string) => propertyId === 'note.subcategory' ? listValue : null }],
			},
			createFileForView,
		};
		const leaf = { view: { containerEl: root, nativeTable } };
		const app = appWithLeaves([leaf as unknown as WorkspaceLeaf]);

		expect(canCreateNativeFileForGroup(app, root, 'note.subcategory')).toBe(true);
		await expect(createNativeFileForGroup(
			app, root, 'note.subcategory', 'Baby home preparation',
		)).resolves.toBe(true);
		expect(createFileForView).toHaveBeenCalledOnce();
		expect(createFileForView.mock.calls[0]?.[0]).toBe('New todo');
		expect(frontmatter).toEqual({
			tags: ['todo'],
			owner: 'Gabriel',
			subcategory: ['Baby home preparation'],
		});
	});

	it('rejects non-note, scalar, malformed, and unsupported group creation', async () => {
		const root = document.body.createDiv('workspace-leaf-content');
		const table = root.createDiv('bases-table-container');
		const createFileForView = vi.fn(async () => undefined);
		const nativeTable = {
			type: 'table',
			containerEl: table,
			config: { get: vi.fn(), set: vi.fn() },
			data: {
				properties: ['note.subcategory'],
				data: [{ getValue: () => 'General' }],
			},
			createFileForView,
		};
		const leaf = { view: { containerEl: root, nativeTable } };
		const app = appWithLeaves([leaf as unknown as WorkspaceLeaf]);

		expect(canCreateNativeFileForGroup(app, root, 'note.subcategory')).toBe(false);
		expect(canCreateNativeFileForGroup(app, root, 'formula.subcategory')).toBe(false);
		expect(canCreateNativeFileForGroup(app, root, 'file.name')).toBe(false);
		await expect(createNativeFileForGroup(app, root, 'bad-id', 'General')).resolves.toBe(false);
		expect(createFileForView).not.toHaveBeenCalled();
	});

});

describe('native table view lookup cost', () => {
	/** A view whose object graph counts how often it is searched. */
	function countingView(container: HTMLElement, child: object | null) {
		const counter = { reads: 0 };
		const view = { containerEl: container } as Record<string, unknown>;
		Object.defineProperty(view, 'renderer', {
			enumerable: true,
			get: () => {
				counter.reads += 1;
				return child ?? {};
			},
		});
		return { view, counter };
	}

	function nativeTable(container: HTMLElement) {
		return { type: 'table', containerEl: container, config: { get: () => undefined, set: () => undefined } };
	}

	it('searches a leaf once when no table is found, until the misses are forgotten', () => {
		const root = document.body.createDiv();
		const scope = root.createDiv();
		const { view, counter } = countingView(root, null);
		const app = appWithLeaves([{ view } as unknown as WorkspaceLeaf]);

		expect(findNativeTableView(app, scope)).toBeNull();
		expect(findNativeTableView(app, scope)).toBeNull();
		expect(counter.reads).toBe(1);

		forgetNativeTableViewMisses();
		expect(findNativeTableView(app, scope)).toBeNull();
		expect(counter.reads).toBe(2);
	});

	it('never searches a leaf whose DOM does not hold the element', () => {
		const other = document.body.createDiv();
		const root = document.body.createDiv();
		const table = root.createDiv();
		const unrelated = countingView(other, null);
		const owner = { view: { containerEl: root, renderer: { child: nativeTable(table) } } };
		const app = appWithLeaves([{ view: unrelated.view } as unknown as WorkspaceLeaf, owner as unknown as WorkspaceLeaf]);

		expect(findNativeTableView(app, table)?.containerEl).toBe(table);
		expect(unrelated.counter.reads).toBe(0);
	});

	it('matches other cells of a table already found without searching again', () => {
		const root = document.body.createDiv();
		const table = root.createDiv();
		const firstCell = table.createDiv();
		const secondCell = table.createDiv();
		const { view, counter } = countingView(root, { child: nativeTable(table) });
		const app = appWithLeaves([{ view } as unknown as WorkspaceLeaf]);

		expect(findNativeTableView(app, firstCell)?.containerEl).toBe(table);
		expect(findNativeTableView(app, secondCell)?.containerEl).toBe(table);
		expect(counter.reads).toBe(1);
	});
});

function appWithLeaves(leaves: WorkspaceLeaf[]): App {
	return {
		workspace: {
			getLeavesOfType: (type: string) => type === 'bases' ? leaves : [],
		},
	} as unknown as App;
}

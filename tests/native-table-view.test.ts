import type { App, WorkspaceLeaf } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import {
	applyNativeColumnWidthPreset,
	getNativeUnsetColumnProperties,
	getNativeMainProperty,
	getNativeRowHeight,
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
				get: (key: string) => values.get(key),
				set,
				getOrder: () => ['file.name', 'note.status'],
			},
		};
		const leaf = { view: { containerEl: root, renderer: { child: nativeTable } } };
		const app = appWithLeaves([leaf as unknown as WorkspaceLeaf]);

		expect(getNativeRowHeight(app, root)).toBe('tall');
		expect(getNativeMainProperty(app, root)).toBe('file.name');
		expect(setNativeRowHeight(app, root, 'medium')).toBe(true);
		expect(set).toHaveBeenCalledWith('rowHeight', 'medium');
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
});

function appWithLeaves(leaves: WorkspaceLeaf[]): App {
	return {
		workspace: {
			getLeavesOfType: (type: string) => type === 'bases' ? leaves : [],
		},
	} as unknown as App;
}

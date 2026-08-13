import type { App, WorkspaceLeaf } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableLayoutPopover } from '../src/ui/table-layout-popover';
import { SettingsStore } from '../src/core/settings-store';

afterEach(() => document.body.replaceChildren());

describe('TableLayoutPopover', () => {
	it('groups row height and scoped column width controls', () => {
		const root = document.body.createDiv('workspace-leaf-content');
		const toolbarItem = root.createDiv('bases-toolbar-item');
		const anchor = toolbarItem.createEl('button');
		const table = root.createDiv('bases-table-container');
		const thead = table.createDiv('bases-thead');
		const headerCells: Array<{ prop: string; el: HTMLElement }> = [];
		for (const [propertyId, label] of [
			['file.name', 'Name'],
			['note.status', 'Status'],
		] as const) {
			const cell = thead.createDiv('bases-td');
			cell.createSpan({ cls: 'bases-table-header-label', text: label });
			headerCells.push({ prop: propertyId, el: cell });
		}
		const values = new Map<string, unknown>();
		const columnInfo = {
			'file.name': { headerWidth: 80, contentWidth: 120, customWidth: 210 },
			'note.status': { headerWidth: 70, contentWidth: 90, customWidth: 0 },
		};
		const nativeTable = {
			type: 'table',
			containerEl: table,
			config: {
				get: (key: string) => values.get(key),
				set: vi.fn((key: string, value: unknown) => values.set(key, value)),
			},
			data: { properties: ['file.name', 'note.status'] },
			columnInfo,
			minColWidth: 40,
			maxColWidth: 300,
			updateVirtualDisplay: vi.fn(),
			header: { cells: headerCells },
		};
		const leaf = { view: { containerEl: root, nativeTable } } as unknown as WorkspaceLeaf;
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
		} as unknown as App;
		const store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		const popover = new TableLayoutPopover(app, store);

		popover.open(anchor, root);
		expect(document.querySelector('.bpc-layout-popover')?.textContent).not.toContain('Auto-fit');
		const scopeNote = document.querySelector<HTMLElement>('.bpc-width-scope-note');
		expect(scopeNote?.textContent).toContain('show which columns will change');
		expect(scopeNote?.hidden).toBe(false);
		const tall = [...document.querySelectorAll<HTMLButtonElement>('.bpc-row-height-options button')]
			.find((button) => button.getAttribute('aria-label') === 'Tall');
		tall?.click();
		expect(values.get('rowHeight')).toBe('tall');

		const standard = [...document.querySelectorAll<HTMLButtonElement>('.bpc-width-preset')]
			.find((button) => button.textContent?.includes('Standard'));
		standard?.click();
		expect(columnInfo['file.name'].customWidth).toBe(210);
		expect(columnInfo['note.status'].customWidth).toBe(160);
		expect(document.querySelector('.bpc-layout-section__meta')?.textContent).toBe('2 of 2 set');
		expect(document.querySelector('.bpc-layout-popover')).not.toBeNull();
		const indicators = root.querySelectorAll<HTMLElement>('.bpc-column-width-indicator');
		expect(indicators).toHaveLength(2);
		expect(indicators[0]?.classList.contains('is-matching')).toBe(false);
		expect(indicators[1]?.classList.contains('is-matching')).toBe(true);

		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		popover.open(anchor, root);
		const selectedStandard = [...document.querySelectorAll<HTMLButtonElement>('.bpc-width-preset')]
			.find((button) => button.textContent?.includes('Standard'));
		expect(selectedStandard?.getAttribute('aria-pressed')).toBe('true');
		const wide = [...document.querySelectorAll<HTMLButtonElement>('.bpc-width-preset')]
			.find((button) => button.textContent?.includes('Wide'));
		wide?.click();
		expect(columnInfo['file.name'].customWidth).toBe(210);
		expect(columnInfo['note.status'].customWidth).toBe(240);
		expect(store.settings.lastColumnWidthPreset).toBe(240);
		expect(document.querySelector('.bpc-layout-popover')).not.toBeNull();

		const all = [...document.querySelectorAll<HTMLButtonElement>('.bpc-width-scope button')]
			.find((button) => button.textContent === 'All columns');
		all?.click();
		expect(document.querySelector<HTMLElement>('.bpc-width-scope-note')?.hidden).toBe(true);
		wide?.click();
		expect(columnInfo['file.name'].customWidth).toBe(210);
		expect(document.querySelector('.modal-container')?.getAttribute('data-title'))
			.toBe('Apply width to all columns?');
		clickModalAction('Cancel');
		expect(columnInfo['file.name'].customWidth).toBe(210);
		expect(document.querySelector('.bpc-layout-popover')).not.toBeNull();
		wide?.click();
		clickModalAction('Apply to all');
		expect(columnInfo['file.name'].customWidth).toBe(240);
		expect(columnInfo['note.status'].customWidth).toBe(240);
		expect(document.querySelector('.bpc-layout-popover')).not.toBeNull();

		const reveal = [...document.querySelectorAll<HTMLButtonElement>('button')]
			.find((button) => button.textContent?.includes('Save current layout'));
		reveal?.click();
		const name = document.querySelector<HTMLInputElement>('input[aria-label="Layout name"]');
		if (name) name.value = 'Writing';
		document.querySelector<HTMLFormElement>('.bpc-layout-creator__form')?.dispatchEvent(
			new Event('submit', { bubbles: true, cancelable: true }),
		);
		expect(store.settings.layoutPresets[0]).toMatchObject({
			name: 'Writing', rowHeight: 'tall', columnWidth: 240, columnScope: 'all',
		});
		expect(document.querySelector('.bpc-layout-popover')?.textContent).toContain('Writing');
		const saved = [...document.querySelectorAll<HTMLButtonElement>('.bpc-layout-preset__apply')]
			.find((button) => button.textContent?.includes('Writing'));
		const short = [...document.querySelectorAll<HTMLButtonElement>('.bpc-row-height-options button')]
			.find((button) => button.getAttribute('aria-label') === 'Short');
		short?.click();
		const compact = [...document.querySelectorAll<HTMLButtonElement>('.bpc-width-preset')]
			.find((button) => button.textContent?.includes('Compact'));
		compact?.click();
		clickModalAction('Apply to all');
		saved?.click();
		expect(values.get('rowHeight')).toBeNull();
		expect(columnInfo['file.name'].customWidth).toBe(100);
		expect(document.querySelector('.modal-container')?.getAttribute('data-title'))
			.toBe('Apply “Writing” to all columns?');
		clickModalAction('Apply layout');
		expect(values.get('rowHeight')).toBe('tall');
		expect(columnInfo['file.name'].customWidth).toBe(240);
		expect(columnInfo['note.status'].customWidth).toBe(240);
		expect(document.querySelector('.bpc-layout-popover')).not.toBeNull();

		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(document.querySelector('.bpc-layout-popover')).toBeNull();
		expect(root.querySelector('.bpc-column-width-indicator')).toBeNull();

		popover.toggle(anchor, root);
		expect(document.querySelector('.bpc-layout-popover')).not.toBeNull();
		popover.toggle(anchor, root);
		expect(document.querySelector('.bpc-layout-popover')).toBeNull();
		expect(root.querySelector('.bpc-column-width-indicator')).toBeNull();
		store.dispose();
	});
});

function clickModalAction(label: string): void {
	const button = [...document.querySelectorAll<HTMLButtonElement>('.modal-container button')]
		.find((candidate) => candidate.textContent === label);
	expect(button, `Missing modal action: ${label}`).toBeDefined();
	button?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
	expect(document.querySelector('.bpc-layout-popover')).not.toBeNull();
	button?.click();
}

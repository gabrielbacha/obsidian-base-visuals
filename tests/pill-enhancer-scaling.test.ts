import type { App, EventRef } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** How often the enhancer reads each column's style: once per cell it styles. */
const calls = vi.hoisted(() => ({ columnAppearance: 0 }));
vi.mock('../src/core/native-table-view', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/core/native-table-view')>();
	return {
		...actual,
		getNativeColumnAppearance: (...args: Parameters<typeof actual.getNativeColumnAppearance>) => {
			calls.columnAppearance += 1;
			return actual.getNativeColumnAppearance(...args);
		},
	};
});

import { PillEnhancer } from '../src/core/pill-enhancer';
import { SettingsStore } from '../src/core/settings-store';

const ROWS = 60;
const GROUPS = ['Backlog', 'Todo', 'Doing', 'Done'];
const PROPERTIES = ['file.name', 'note.status', 'note.tags', 'note.owner', 'note.due'];
const LIST_PROPERTIES = new Set(['note.status', 'note.tags']);
const BODY_CELLS = ROWS * PROPERTIES.length;

let enhancer: PillEnhancer | null = null;

afterEach(() => {
	enhancer?.stop();
	enhancer = null;
	document.body.replaceChildren();
});

describe('PillEnhancer on a large grouped table', () => {
	it('styles each changed cell once, not the whole table per change', async () => {
		const { table, store } = createGroupedTable({ sortButton: true });
		enhancer = new PillEnhancer(appFor(table), store);
		enhancer.start(() => undefined);
		await mutationCycle();

		// Obsidian rewrites every visible cell in place, as after an edit or a scroll.
		calls.columnAppearance = 0;
		for (const text of table.querySelectorAll<HTMLElement>('.bases-tbody .metadata-input-longtext')) {
			text.textContent = `${text.textContent ?? ''}!`;
		}
		await mutationCycle();
		expect(calls.columnAppearance).toBeLessThanOrEqual(BODY_CELLS);

		// Obsidian renders the body again, with values the store has not seen yet.
		calls.columnAppearance = 0;
		table.querySelector('.bases-tbody')?.remove();
		renderBody(table, 'next');
		await mutationCycle();
		expect(calls.columnAppearance).toBeLessThanOrEqual(2 * BODY_CELLS);
	});

	it('places its toolbar controls once when the toolbar has no sort button', async () => {
		const { table, toolbar, store } = createGroupedTable({ sortButton: false });
		enhancer = new PillEnhancer(appFor(table), store);
		enhancer.start(() => undefined);
		await mutationCycle();
		await mutationCycle();
		expect([...toolbar.children].map((item) => item.className)).toEqual([
			'bases-toolbar-item bpc-toolbar-control bpc-conditional-formatting-button',
			'bases-toolbar-item bpc-toolbar-control bpc-table-layout-button',
		]);
	});
});

function createGroupedTable({ sortButton }: { sortButton: boolean }): {
	table: HTMLElement;
	toolbar: HTMLElement;
	store: SettingsStore;
} {
	const root = document.body.createDiv('workspace-leaf-content');
	root.dataset.type = 'bases';
	const view = root.createDiv('bases-view');
	const toolbar = view.createDiv('bases-toolbar');
	if (sortButton) toolbar.createDiv('bases-toolbar-item bases-toolbar-sort-menu');
	const table = view.createDiv('bases-table-container');
	const headRow = table.createDiv('bases-thead').createDiv('bases-tr');
	for (const propertyId of PROPERTIES) {
		const cell = headRow.createDiv({ cls: 'bases-td', text: propertyId });
		cell.dataset.property = propertyId;
	}
	renderBody(table, 'first');
	const store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
	return { table, toolbar, store };
}

function renderBody(table: HTMLElement, prefix: string): void {
	const body = table.createDiv('bases-tbody');
	GROUPS.forEach((group, groupIndex) => {
		const heading = body.createDiv('bases-group-heading');
		heading.createSpan({ cls: 'bases-group-property', text: 'Status' });
		heading.createSpan({ cls: 'bases-group-value', text: group });
		for (let index = groupIndex; index < ROWS; index += GROUPS.length) {
			const row = body.createDiv('bases-tr');
			for (const propertyId of PROPERTIES) {
				const cell = row.createDiv('bases-td');
				cell.dataset.property = propertyId;
				const values = propertyId === 'note.status' ? [group] : [`${prefix}-${index}`];
				if (LIST_PROPERTIES.has(propertyId)) {
					for (const value of values) {
						cell.createDiv('multi-select-pill').createSpan({ cls: 'multi-select-pill-content', text: value });
					}
				} else {
					cell.createDiv({ cls: 'metadata-input-longtext', text: values.join(', ') });
				}
			}
		}
	});
}

function appFor(table: HTMLElement): App {
	const headerCells = [...table.querySelectorAll<HTMLElement>('.bases-thead .bases-td')]
		.map((el) => ({ prop: el.dataset.property ?? '', el }));
	const nativeView = {
		type: 'table',
		containerEl: table,
		config: {
			groupBy: { property: 'note.status' },
			get: () => undefined,
			set: () => undefined,
			getOrder: () => PROPERTIES,
			getDisplayName: (propertyId: string) => propertyId.replace(/^(?:note|file)\./, ''),
		},
		data: {
			properties: PROPERTIES,
			data: Array.from({ length: ROWS }, (_, index) => ({
				getValue: (propertyId: string) => LIST_PROPERTIES.has(propertyId)
					? { length: () => 1, get: () => `value-${index}` }
					: { toString: () => `value-${index}` },
			})),
		},
		createFileForView: async () => undefined,
		header: { cells: headerCells },
	};
	const leafView = { containerEl: table.closest('.workspace-leaf-content'), renderer: { child: nativeView } };
	return {
		workspace: {
			getLeavesOfType: (type: string) => type === 'bases' ? [{ view: leafView }] : [],
			on: () => ({}) as EventRef,
		},
		metadataCache: { getFirstLinkpathDest: () => null },
		vault: { getAbstractFileByPath: () => null },
	} as unknown as App;
}

async function mutationCycle(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
}

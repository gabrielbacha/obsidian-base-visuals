import type { App, EventRef } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColumnMenuRequest, PillEnhancer } from '../src/core/pill-enhancer';
import { SettingsStore } from '../src/core/settings-store';

interface Harness {
	root: HTMLElement;
	store: SettingsStore;
	stores: SettingsStore[];
	enhancer: PillEnhancer;
}

interface PillSpec {
	propertyId: string;
	value: string;
	inBase?: boolean;
	title?: string;
}

interface NativeFixtureOptions {
	groupProperty?: string;
	columnAppearances?: Record<string, unknown>;
	useScopedStore?: boolean;
	dataProperties?: string[];
	order?: string[];
}

const activeHarnesses: Harness[] = [];

afterEach(() => {
	for (const harness of activeHarnesses.splice(0)) {
		harness.enhancer.stop();
		for (const store of harness.stores) store.dispose();
	}
	document.body.replaceChildren();
});

describe('PillEnhancer', () => {
	it('styles only list pills inside Base scopes', () => {
		const harness = createHarness([
			{ propertyId: 'note.status', value: 'In progress' },
			{ propertyId: 'note.status', value: 'Outside', inBase: false },
		]);
		const pills = harness.root.querySelectorAll<HTMLElement>('.multi-select-pill');
		expect(pills[0]?.classList.contains('bpc-pill--colored')).toBe(true);
		expect(pills[0]?.title).toBe('In progress');
		expect(pills[1]?.classList.contains('bpc-pill')).toBe(false);
	});

	it('does not style list-like pills in non-table Base layouts', async () => {
		const harness = createHarness([]);
		const card = document.body.createDiv();
		card.className = 'bases-cards-property';
		card.dataset.property = 'note.status';
		const pillElement = card.createDiv();
		pillElement.className = 'multi-select-pill';
		const content = pillElement.createSpan();
		content.className = 'multi-select-pill-content';
		content.textContent = 'Card value';
		pillElement.appendChild(content);
		card.appendChild(pillElement);
		harness.root.querySelector('.bases-view')?.appendChild(card);
		await mutationCycle();

		expect(pillElement.classList.contains('bpc-pill')).toBe(false);
	});

	it('discovers virtualized rows added after startup', async () => {
		const harness = createHarness([]);
		const view = harness.root.querySelector('.bases-view');
		if (view) appendPill(view, { propertyId: 'note.priority', value: '3. Later' });
		await mutationCycle();
		const added = harness.root.querySelector<HTMLElement>('.multi-select-pill');
		expect(added?.classList.contains('bpc-pill--colored')).toBe(true);
		expect(harness.store.allOptions()[0]?.value).toBe('3. Later');
	});

	it('colors grouped row headings with the exact property and pill value color', () => {
		const harness = createHarness(
			[{ propertyId: 'note.category', value: '01 Product configuration' }],
			(baseView) => appendGroupHeading(
				baseView,
				null,
				'category',
				'01 Product configuration',
			),
			undefined,
			undefined,
			{ groupProperty: 'note.category' },
		);
		const pill = harness.root.querySelector<HTMLElement>('.bpc-pill');
		const heading = harness.root.querySelector<HTMLElement>('.bases-group-heading');
		expect(heading?.classList.contains('bpc-group-heading--colored')).toBe(true);
		expect(heading?.style.getPropertyValue('--bpc-bg')).toBe(
			pill?.style.getPropertyValue('--bpc-bg'),
		);
		expect(heading?.dataset.bpcKey).toBe(pill?.dataset.bpcKey);
		expect(heading?.querySelector('.bases-group-property')?.textContent).toBe('category');
	});

	it('updates grouped row heading colors live and removes all styling on cleanup', () => {
		const harness = createHarness([], (baseView) => appendGroupHeading(
			baseView,
			'note.category',
			'category',
			'02 User identity and control',
		));
		const identity = {
			propertyId: 'note.category',
			value: '02 User identity and control',
		};
		const heading = harness.root.querySelector<HTMLElement>('.bases-group-heading');
		harness.store.setOverride(identity, { kind: 'custom', hex: '#123456' });
		expect(heading?.style.getPropertyValue('--bpc-bg')).toContain('#123456');
		harness.store.setOverride(identity, { kind: 'disabled' });
		expect(heading?.classList.contains('bpc-group-heading--colored')).toBe(false);
		expect(heading?.style.getPropertyValue('--bpc-bg')).toBe('');

		harness.enhancer.stop();
		expect(heading?.classList.contains('bpc-group-heading')).toBe(false);
		expect(heading?.dataset.bpcKey).toBeUndefined();
	});

	it('discovers grouped row headings added by virtualized table rendering', async () => {
		const harness = createHarness([]);
		const baseView = harness.root.querySelector<HTMLElement>('.bases-view');
		if (baseView) appendGroupHeading(baseView, 'note.category', 'category', 'Later group');
		await mutationCycle();
		expect(
			harness.root.querySelector('.bases-group-heading')?.classList.contains('bpc-group-heading--colored'),
		).toBe(true);
		expect(harness.store.get({ propertyId: 'note.category', value: 'Later group' })).toBeDefined();
	});

	it('keeps identical values independent across properties', () => {
		const harness = createHarness([
			{ propertyId: 'note.status', value: 'Same' },
			{ propertyId: 'note.category', value: 'Same' },
		]);
		harness.store.setOverride(
			{ propertyId: 'note.status', value: 'Same' },
			{ kind: 'custom', hex: '#123456' },
		);
		const pills = harness.root.querySelectorAll<HTMLElement>('.multi-select-pill');
		expect(pills[0]?.style.getPropertyValue('--bpc-bg')).toContain('#123456');
		expect(pills[1]?.style.getPropertyValue('--bpc-bg')).not.toContain('#123456');
	});

	it('applies and updates the property pill style across visible pills', () => {
		const harness = createHarness([{ propertyId: 'note.status', value: 'Done' }]);
		const pill = harness.root.querySelector<HTMLElement>('.bpc-pill');
		expect(pill?.classList.contains('bpc-pill-style-soft')).toBe(true);
		harness.store.setPropertyStyle('note.status', 'solid');
		expect(pill?.classList.contains('bpc-pill-style-solid')).toBe(true);
		expect(pill?.style.getPropertyValue('--bpc-accent')).toBe('#16A085');
		harness.store.setPropertyStyle('note.status', 'outline');
		expect(pill?.classList.contains('bpc-pill-style-outline')).toBe(true);
		expect(pill?.classList.contains('bpc-pill-style-solid')).toBe(false);
	});

	it('refreshes style changes immediately from a Base-scoped store', () => {
		const harness = createHarness(
			[{ propertyId: 'note.status', value: 'Done' }],
			undefined,
			undefined,
			undefined,
			{ useScopedStore: true },
		);
		const pill = harness.root.querySelector<HTMLElement>('.bpc-pill');
		harness.store.setPropertyStyle('note.status', 'solid');
		expect(pill?.classList.contains('bpc-pill-style-solid')).toBe(true);
		harness.store.setPropertyStyle('note.status', 'outline');
		expect(pill?.classList.contains('bpc-pill-style-outline')).toBe(true);
		expect(pill?.classList.contains('bpc-pill-style-solid')).toBe(false);
	});

	it('restores Outline styling after Obsidian rewrites a pill class in place', async () => {
		const harness = createHarness([{ propertyId: 'note.status', value: 'Done' }]);
		const pill = harness.root.querySelector<HTMLElement>('.bpc-pill');
		harness.store.setPropertyStyle('note.status', 'outline');
		expect(pill?.classList.contains('bpc-pill-style-outline')).toBe(true);

		if (pill) pill.className = 'multi-select-pill';
		await mutationCycle();

		expect(pill?.classList.contains('bpc-pill')).toBe(true);
		expect(pill?.classList.contains('bpc-pill-style-outline')).toBe(true);
		expect(pill?.classList.contains('bpc-pill-style-solid')).toBe(false);
	});

	it('supports Unicode, punctuation, and long exact values', () => {
		const value = '🔵 Déjà vu / Very long value: 100% + ready?';
		const harness = createHarness([
			{ propertyId: 'note.tags', value },
			{ propertyId: 'note.tags', value: '   ' },
		]);
		expect(harness.store.allOptions()[0]?.value).toBe(value);
		expect(harness.store.allOptions()).toHaveLength(1);
		expect(
			harness.root.querySelector<HTMLElement>('.multi-select-pill')?.title,
		).toBe(value);
	});

	it('preserves native left-click and replaces only the tracked pill context menu', () => {
		const opened = vi.fn<(request: ColumnMenuRequest) => void>();
		const harness = createHarness([
			{ propertyId: 'note.status', value: 'Done' },
		], undefined, undefined, opened);
		const target = harness.root.querySelector<HTMLElement>('.multi-select-pill-content');
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		expect(target?.dispatchEvent(click)).toBe(true);

		const nativeContextMenu = vi.fn();
		target?.addEventListener('contextmenu', nativeContextMenu);
		target?.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: 40,
				clientY: 40,
			}),
		);
		expect(nativeContextMenu).not.toHaveBeenCalled();
		expect(opened).toHaveBeenCalledOnce();
		expect(opened.mock.calls[0]?.[0]).toMatchObject({
			propertyId: 'note.status',
			value: 'Done',
			values: ['Done'],
		});
	});

	it('uses the hidden native control to remove the clicked pill from its row', () => {
		const removed = vi.fn();
		let request: ColumnMenuRequest | undefined;
		const harness = createHarness(
			[{ propertyId: 'note.status', value: 'Done' }],
			(baseView) => baseView.querySelector('.multi-select-pill-remove-button')?.addEventListener('click', (event) => {
				removed();
				(event.currentTarget as Element).closest('.multi-select-pill')?.remove();
			}),
			undefined,
			(next) => { request = next; },
		);
		harness.root.querySelector<HTMLElement>('.multi-select-pill')?.dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
		);
		request?.removal.remove();
		expect(removed).toHaveBeenCalledOnce();
	});

	it('removes only the active pill when Delete or Backspace is pressed', () => {
		const removed = vi.fn();
		const nativeCellDelete = vi.fn();
		const harness = createHarness(
			[
				{ propertyId: 'note.status', value: 'Doing' },
				{ propertyId: 'note.status', value: 'Done' },
			],
			(baseView) => {
				baseView.querySelectorAll('.multi-select-pill-remove-button')[1]?.addEventListener('click', (event) => {
					removed();
					(event.currentTarget as Element).closest('.multi-select-pill')?.remove();
				});
				baseView.addEventListener('keydown', nativeCellDelete);
			},
		);
		const pills = harness.root.querySelectorAll<HTMLElement>('.multi-select-pill');
		const target = pills[1]?.querySelector<HTMLElement>('.multi-select-pill-content');
		target?.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
		expect(pills[1]?.classList.contains('bpc-pill--active')).toBe(true);

		const deletion = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
		expect(target?.dispatchEvent(deletion)).toBe(false);
		expect(removed).toHaveBeenCalledOnce();
		expect(nativeCellDelete).not.toHaveBeenCalled();
		expect(pills[1]?.classList.contains('bpc-pill--active')).toBe(false);
	});

	it('blocks cell deletion when an active pill has no compatible native remove control', () => {
		const nativeCellDelete = vi.fn();
		const harness = createHarness(
			[{ propertyId: 'note.status', value: 'Done' }],
			(baseView) => baseView.addEventListener('keydown', nativeCellDelete),
		);
		const pill = harness.root.querySelector<HTMLElement>('.multi-select-pill');
		pill?.querySelector('.multi-select-pill-remove-button')?.remove();
		pill?.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
		const deletion = new KeyboardEvent('keydown', {
			key: 'Backspace', bubbles: true, cancelable: true,
		});
		expect(pill?.dispatchEvent(deletion)).toBe(false);
		expect(nativeCellDelete).not.toHaveBeenCalled();
		expect(pill?.isConnected).toBe(true);
		expect(pill?.classList.contains('bpc-pill--active')).toBe(false);
	});

	it('leaves Delete native when no pill is active or text is being edited', () => {
		const nativeDelete = vi.fn();
		const removed = vi.fn();
		const harness = createHarness(
			[{ propertyId: 'note.status', value: 'Done' }],
			(baseView) => {
				baseView.querySelector('.multi-select-pill-remove-button')?.addEventListener('click', removed);
				baseView.addEventListener('keydown', nativeDelete);
				const input = baseView.createEl('input');
				input.value = 'editing';
			},
		);
		const view = harness.root.querySelector<HTMLElement>('.bases-view');
		view?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
		expect(nativeDelete).toHaveBeenCalledOnce();

		const pill = harness.root.querySelector<HTMLElement>('.bpc-pill');
		pill?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		const input = view?.querySelector<HTMLInputElement>('input');
		input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
		expect(removed).not.toHaveBeenCalled();
		expect(nativeDelete).toHaveBeenCalledTimes(2);
	});

	it('accumulates virtualized values per table and property without cross-table leakage', async () => {
		const opened = vi.fn<(request: ColumnMenuRequest) => void>();
		const harness = createHarness(
			[{ propertyId: 'note.status', value: 'Doing' }],
			undefined,
			undefined,
			opened,
		);
		const baseView = harness.root.querySelector<HTMLElement>('.bases-view');
		if (baseView) appendPill(baseView, { propertyId: 'note.status', value: 'Done' });
		await mutationCycle();
		harness.root.querySelector<HTMLElement>('.multi-select-pill')?.dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
		);
		expect(opened.mock.calls[0]?.[0].values).toEqual(['Doing', 'Done']);

		const embed = harness.root.createDiv('bases-embed');
		appendPill(embed, { propertyId: 'note.status', value: 'Elsewhere' });
		await mutationCycle();
		embed.querySelector<HTMLElement>('.multi-select-pill')?.dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
		);
		expect(opened.mock.calls[1]?.[0].values).toEqual(['Elsewhere']);
	});

	it('processes each added subtree with one combined discovery traversal', async () => {
		const harness = createHarness([]);
		const wrapper = document.body.createDiv();
		wrapper.remove();
		appendPill(wrapper, { propertyId: 'note.status', value: 'Nested' });
		const traversal = vi.spyOn(wrapper, 'querySelectorAll');
		harness.root.querySelector('.bases-view')?.appendChild(wrapper);
		await mutationCycle();
		expect(traversal).toHaveBeenCalledOnce();
		expect(wrapper.querySelector('.multi-select-pill')?.classList.contains('bpc-pill')).toBe(true);
	});

	it('cleans tracked elements from detached roots without touching unrelated DOM', async () => {
		const harness = createHarness([]);
		const wrapper = document.body.createDiv();
		wrapper.remove();
		appendPill(wrapper, { propertyId: 'note.status', value: 'Detached' });
		harness.root.querySelector('.bases-view')?.appendChild(wrapper);
		await mutationCycle();
		const pill = wrapper.querySelector<HTMLElement>('.multi-select-pill');
		const unrelated = document.body.createDiv('bpc-pill unrelated');
		wrapper.remove();
		await mutationCycle();
		expect(pill?.classList.contains('bpc-pill')).toBe(false);
		expect(unrelated.classList.contains('bpc-pill')).toBe(true);
	});

	it('restores attributes and classes when stopped', () => {
		const harness = createHarness([
			{ propertyId: 'note.status', value: 'Done', title: 'Original' },
		]);
		const target = harness.root.querySelector<HTMLElement>('.multi-select-pill');
		harness.enhancer.stop();
		expect(target?.classList.contains('bpc-pill')).toBe(false);
		expect(target?.classList.contains('bpc-pill--active')).toBe(false);
		expect(target?.getAttribute('title')).toBe('Original');
		expect(target?.style.getPropertyValue('--bpc-bg')).toBe('');
	});

	it('applies ordered cell and row rules and updates them live', () => {
		const harness = createHarness([], (baseView) => appendTableRow(baseView, 'note.status', 'Done'));
		const row = harness.root.querySelector<HTMLElement>('.bases-tr');
		const cell = harness.root.querySelector<HTMLElement>('.bases-td');
		const rowRule = harness.store.addRule('note.status');
		harness.store.updateRule(rowRule.id, { operand: 'done', target: 'row', color: { kind: 'preset', name: 'green-sea' } });
		const cellRule = harness.store.addRule('note.status');
		harness.store.updateRule(cellRule.id, { operand: 'done', target: 'cell', color: { kind: 'preset', name: 'pomegranate' } });

		expect(row?.dataset.bpcRuleId).toBe(rowRule.id);
		expect(cell?.dataset.bpcRuleId).toBe(cellRule.id);
		harness.store.updateRule(cellRule.id, { enabled: false });
		expect(cell?.classList.contains('bpc-rule-cell')).toBe(false);
	});

	it('handles checkbox and live input values', () => {
		const harness = createHarness([], (baseView) => {
			const row = baseView.createDiv('bases-tr');
			const checkboxCell = row.createDiv('bases-td');
			checkboxCell.dataset.property = 'note.done';
			const checkbox = checkboxCell.createEl('input', { attr: { type: 'checkbox' } });
			checkbox.checked = true;
			const inputCell = row.createDiv('bases-td');
			inputCell.dataset.property = 'note.score';
			const input = inputCell.createEl('input');
			input.value = '12';
		});
		const checkboxRule = harness.store.addRule('note.done');
		harness.store.updateRule(checkboxRule.id, { operand: 'true' });
		const numberRule = harness.store.addRule('note.score');
		harness.store.updateRule(numberRule.id, { operator: 'greater-than', operand: '10' });
		const cells = harness.root.querySelectorAll<HTMLElement>('.bases-td');
		expect(cells[0]?.classList.contains('bpc-rule-cell')).toBe(true);
		expect(cells[1]?.classList.contains('bpc-rule-cell')).toBe(true);
		const input = cells[1]?.querySelector<HTMLInputElement>('input');
		if (input) input.value = '2';
		input?.dispatchEvent(new Event('input', { bubbles: true }));
		expect(cells[1]?.classList.contains('bpc-rule-cell')).toBe(false);
	});

	it('groups table layout controls into one native button before Sort', async () => {
		const opened = vi.fn();
		const harness = createHarness([], (baseView) => {
			const header = baseView.parentElement?.createDiv('bases-header');
			const toolbar = header?.createDiv('bases-toolbar');
			if (!toolbar) throw new Error('Missing native Base toolbar fixture');
			appendToolbarItem(toolbar, 'bases-toolbar-views-menu', 'Table');
			toolbar.createSpan({ text: '5 results', cls: 'bases-toolbar-item bases-toolbar-result-count' });
			appendToolbarItem(toolbar, 'bases-toolbar-sort-menu', 'Sort');
			appendToolbarItem(toolbar, 'bases-toolbar-filter-menu', 'Filter');
			appendToolbarItem(toolbar, 'bases-toolbar-properties-menu', 'Properties');
			appendTableRow(baseView, 'note.priority', 'Later');
		}, opened);
		const items = harness.root.querySelectorAll<HTMLElement>('.bpc-toolbar-control');
		const buttons = harness.root.querySelectorAll<HTMLElement>('.bpc-conditional-formatting-button > .text-icon-button');
		expect(items).toHaveLength(2);
		expect(buttons).toHaveLength(1);
		const toolbarItems = [...harness.root.querySelectorAll<HTMLElement>('.bases-toolbar > .bases-toolbar-item')];
		expect(toolbarItems.map((item) => item.textContent)).toEqual([
			'Table', '5 results', 'Format', 'Layout', 'Sort', 'Filter', 'Properties',
		]);
		expect(buttons[0]?.tagName).toBe('DIV');
		expect(buttons[0]?.getAttribute('role')).toBe('button');
		expect(buttons[0]?.getAttribute('aria-label')).toBe('Bases visuals');
		expect(buttons[0]?.querySelector('.text-button-label')?.textContent).toBe('Format');

		buttons[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		expect(opened).toHaveBeenCalledWith(['note.priority'], expect.any(HTMLElement));
		buttons[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
		expect(opened).toHaveBeenCalledTimes(2);

		harness.root.querySelector('.bpc-conditional-formatting-button')?.remove();
		await mutationCycle();
		expect(harness.root.querySelectorAll('.bpc-conditional-formatting-button')).toHaveLength(1);
		expect(harness.root.querySelectorAll('.bpc-table-layout-button')).toHaveLength(1);
		harness.enhancer.stop();
		expect(harness.root.querySelector('.bpc-toolbar-control')).toBeNull();
	});

	it('tints tables and bolds the first visible column only', () => {
		const harness = createHarness([], (baseView) => {
			const table = baseView.createDiv('bases-table-container');
			const head = table.createDiv('bases-thead');
			const filenameHeader = head.createDiv('bases-td');
			filenameHeader.dataset.property = 'file.name';
			const statusHeader = head.createDiv('bases-td');
			statusHeader.dataset.property = 'note.status';
			const body = table.createDiv('bases-tbody');
			const row = body.createDiv('bases-tr');
			appendTableCell(row, 'file.name', 'Project');
			appendTableCell(row, 'note.status', 'Active');
		});
		const table = harness.root.querySelector<HTMLElement>('.bases-table-container');
		const cells = harness.root.querySelectorAll<HTMLElement>('.bases-tbody .bases-td');
		expect(table?.classList.contains('bpc-table')).toBe(true);
		expect(cells[0]?.classList.contains('bpc-main-column')).toBe(true);
		expect(cells[1]?.classList.contains('bpc-main-column')).toBe(false);

		harness.enhancer.stop();
		expect(table?.classList.contains('bpc-table')).toBe(false);
		expect(cells[0]?.classList.contains('bpc-main-column')).toBe(false);
	});

	it('adds column appearance to the native header menu and updates the column live', async () => {
		const harness = createHarness([], (baseView) => {
			const table = baseView.createDiv('bases-table-container');
			const head = table.createDiv('bases-thead');
			const header = head.createDiv('bases-td');
			header.dataset.property = 'note.status';
			header.createDiv({ cls: 'bases-table-header-name', text: 'status' });
			header.addEventListener('contextmenu', () => {
				const menu = document.body.createDiv('menu');
				const scroll = menu.createDiv('menu-scroll');
				scroll.createDiv({ cls: 'menu-item selected', text: 'Group by this property' });
				scroll.createDiv('menu-separator');
			});
			const body = table.createDiv('bases-tbody');
			const row = body.createDiv('bases-tr');
			appendTableCell(row, 'note.status', 'Ready');
		}, undefined, undefined, {
			columnAppearances: {
				'note.status': { tone: 'muted', bold: true },
			},
		});
		const header = harness.root.querySelector<HTMLElement>('.bases-thead .bases-td');
		const cell = harness.root.querySelector<HTMLElement>('.bases-tbody .bases-td');
		expect(header?.classList.contains('bpc-column-appearance')).toBe(false);
		expect(cell?.classList.contains('bpc-column-emphasized')).toBe(true);

		header?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await mutationCycle();
		const menuItem = document.querySelector<HTMLElement>('.bpc-column-appearance-menu-item');
		if (!menuItem) throw new Error('Missing column appearance menu item');
		expect(document.querySelector('.bpc-column-pill-appearance-menu-item')).toBeNull();
		expect(menuItem?.textContent).toContain('Column appearance');
		expect(menuItem?.textContent).toContain('Muted + Bold');
		menuItem?.dispatchEvent(new Event('pointerenter', { bubbles: true }));
		expect(menuItem?.classList.contains('selected')).toBe(true);
		expect(
			[...document.querySelectorAll<HTMLElement>('.menu-item')]
				.find((item) => item.textContent === 'Group by this property')
				?.classList.contains('selected'),
		).toBe(false);
		await new Promise((resolve) => window.setTimeout(resolve, 140));
		expect(document.querySelector('.bpc-column-appearance-popover')).not.toBeNull();
		document.querySelector<HTMLButtonElement>('.bpc-column-appearance__header button')?.click();
		menuItem?.classList.remove('selected');
		menuItem.getBoundingClientRect = () => ({
			left: 100, right: 300, top: 80, bottom: 120,
			width: 200, height: 40, x: 100, y: 80, toJSON: () => undefined,
		});
		menuItem?.click();
		await Promise.resolve();
		const popover = document.querySelector<HTMLElement>('.bpc-column-appearance-popover');
		expect(popover).not.toBeNull();
		expect(popover?.style.left).toBe('306px');
		expect(popover?.style.top).toBe('80px');
		const faint = [...document.querySelectorAll<HTMLButtonElement>('.bpc-column-tone-option')]
			.find((button) => button.textContent?.includes('Faint'));
		faint?.click();
		expect(cell?.classList.contains('bpc-column-tone-faint')).toBe(true);
		expect(cell?.classList.contains('bpc-column-emphasized')).toBe(true);
		expect(header?.classList.contains('bpc-column-appearance')).toBe(false);
		const custom = [...document.querySelectorAll<HTMLButtonElement>('.bpc-column-tone-option')]
			.find((button) => button.textContent?.includes('Custom'));
		custom?.click();
		expect(cell?.classList.contains('bpc-column-tone-custom')).toBe(true);
		expect(cell?.style.getPropertyValue('--bpc-column-color')).toBe('#787774');
		expect(header?.style.getPropertyValue('--bpc-column-color')).toBe('');

		harness.enhancer.stop();
		expect(cell?.classList.contains('bpc-column-appearance')).toBe(false);
		expect(document.querySelector('.bpc-column-appearance-popover')).toBeNull();
	});

	it('adds compact pill strategy and style controls to list column menus', async () => {
		const harness = createHarness([], (baseView) => {
			const table = baseView.createDiv('bases-table-container');
			const head = table.createDiv('bases-thead');
			const header = head.createDiv('bases-td');
			header.dataset.property = 'note.status';
			header.createDiv({ cls: 'bases-table-header-name', text: 'Status' });
			header.addEventListener('contextmenu', () => {
				const menu = document.body.createDiv('menu');
				const scroll = menu.createDiv('menu-scroll');
				scroll.createDiv({ cls: 'menu-item selected', text: 'Group by this property' });
				scroll.createDiv('menu-separator');
			});
			const body = table.createDiv('bases-tbody');
			const row = body.createDiv('bases-tr');
			appendPill(row, { propertyId: 'note.status', value: 'Done' });
		}, undefined, undefined, {});
		const header = harness.root.querySelector<HTMLElement>('.bases-thead .bases-td');

		header?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await mutationCycle();
		const item = document.querySelector<HTMLElement>('.bpc-column-pill-appearance-menu-item');
		expect(item?.textContent).toContain('Pill appearance');
		expect(item?.textContent).toContain('Status · Soft');
		if (item) item.getBoundingClientRect = () => ({
			left: 100, right: 300, top: 80, bottom: 120,
			width: 200, height: 40, x: 100, y: 80, toJSON: () => undefined,
		});
		item?.click();
		const panel = document.querySelector<HTMLElement>('.bpc-column-pill-appearance-popover');
		expect(panel).not.toBeNull();
		expect(panel?.style.left).toBe('306px');
		expect(panel?.style.top).toBe('80px');
		expect(document.querySelectorAll('.bpc-column-pill-appearance-menu-item')).toHaveLength(1);
		item?.closest('.menu')?.remove();
		const style = panel?.querySelector<HTMLSelectElement>('select[aria-label="Pill style for Status"]');
		if (style) {
			style.value = 'outline';
			style.dispatchEvent(new Event('change', { bubbles: true }));
		}
		expect(harness.store.getPropertyStyle('note.status')).toBe('outline');
		expect(panel?.style.left).toBe('306px');
		expect(panel?.style.top).toBe('80px');
		expect(harness.root.querySelector('.multi-select-pill')?.classList.contains('bpc-pill-style-outline')).toBe(true);
	});

	it('keeps aliased Status columns configurable under their canonical property id', async () => {
		const harness = createHarness([], (baseView) => {
			const table = baseView.createDiv('bases-table-container');
			const head = table.createDiv('bases-thead');
			const header = head.createDiv('bases-td');
			header.dataset.property = 'Status';
			header.createDiv({ cls: 'bases-table-header-name', text: 'Status' });
			header.addEventListener('contextmenu', () => {
				const menu = document.body.createDiv('menu');
				const scroll = menu.createDiv('menu-scroll');
				scroll.createDiv({ cls: 'menu-item selected', text: 'Group by this property' });
				scroll.createDiv('menu-separator');
			});
			const body = table.createDiv('bases-tbody');
			const row = body.createDiv('bases-tr');
			appendPill(row, { propertyId: 'Status', value: 'Done' });
		}, undefined, undefined, {
			useScopedStore: true,
			dataProperties: ['note.status_todo'],
			order: ['Status'],
		});
		const header = harness.root.querySelector<HTMLElement>('.bases-thead .bases-td');

		header?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await mutationCycle();
		const item = document.querySelector<HTMLElement>('.bpc-column-pill-appearance-menu-item');
		expect(item?.textContent).toContain('Pill appearance');
		item?.click();
		const style = document.querySelector<HTMLSelectElement>('select[aria-label="Pill style for Status"]');
		if (style) {
			style.value = 'solid';
			style.dispatchEvent(new Event('change', { bubbles: true }));
		}
		expect(harness.store.getPropertyStyle('note.status_todo')).toBe('solid');
		expect(harness.store.getExplicitPropertyStrategy('note.status_todo')).toEqual({ mode: 'smart', style: 'solid' });
		expect(harness.store.getExplicitPropertyStrategy('note.status')).toBeUndefined();
		expect(harness.store.getExplicitPropertyStrategy('Status')).toBeUndefined();
		expect(harness.root.querySelector('.multi-select-pill')?.classList.contains('bpc-pill-style-solid')).toBe(true);
	});

	it('leaves context menus outside tracked Base pills untouched', () => {
		const harness = createHarness([{ propertyId: 'note.status', value: 'Done' }]);
		const outside = harness.root.createDiv('outside');
		const nativeContextMenu = vi.fn();
		outside.addEventListener('contextmenu', nativeContextMenu);
		outside.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		expect(nativeContextMenu).toHaveBeenCalledOnce();
		expect(document.querySelector('.bpc-popover')).toBeNull();
	});
});

function createHarness(
	specs: PillSpec[],
	configure?: (baseView: HTMLElement) => void,
	openRuleManager: ((properties: string[]) => void) | undefined = () => undefined,
	openColumnManager: ((request: ColumnMenuRequest) => void) | undefined = () => undefined,
	nativeOptions?: NativeFixtureOptions,
): Harness {
	const root = document.body.createDiv();
	root.className = 'workspace-leaf-content';
	root.dataset.type = 'bases';
	const baseView = root.createDiv();
	baseView.className = 'bases-view';
	root.appendChild(baseView);
	for (const spec of specs) {
		appendPill(spec.inBase === false ? root : baseView, spec);
	}
	configure?.(baseView);
	const globalStore = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
	const store = nativeOptions?.useScopedStore
		? new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined))
		: globalStore;
	const view: Record<string, unknown> = { containerEl: root };
	if (nativeOptions) {
		const table = baseView.querySelector<HTMLElement>('.bases-table-container, .bases-table') ?? baseView;
		const values = new Map<string, unknown>();
		if (nativeOptions.columnAppearances) {
			values.set('basesVisualsColumnAppearance', nativeOptions.columnAppearances);
		}
		const headerCells = [...baseView.querySelectorAll<HTMLElement>('.bases-thead .bases-td')]
			.flatMap((element) => element.dataset.property
				? [{ prop: element.dataset.property, el: element }]
				: []);
		view.renderer = {
			child: {
				type: 'table',
				containerEl: table,
				config: {
					...(nativeOptions.groupProperty
						? { groupBy: { property: nativeOptions.groupProperty } }
						: {}),
					get: (key: string) => values.get(key),
					set: (key: string, value: unknown) => values.set(key, value),
					...(nativeOptions.order ? { getOrder: () => nativeOptions.order ?? [] } : {}),
				},
				...(nativeOptions.dataProperties
					? { data: { properties: nativeOptions.dataProperties, data: [] } }
					: {}),
				header: { cells: headerCells },
			},
		};
	}
	const workspace = {
		getLeavesOfType: (type: string) =>
			type === 'bases' ? [{ view }] : [],
		on: () => ({}) as EventRef,
	};
	const enhancer = new PillEnhancer(
		{ workspace } as unknown as App,
		globalStore,
		openRuleManager,
		openColumnManager,
		() => store,
	);
	enhancer.start(() => undefined);
	const harness = { root, store, stores: store === globalStore ? [store] : [store, globalStore], enhancer };
	activeHarnesses.push(harness);
	return harness;
}

function appendTableRow(parent: Element, propertyId: string, value: string): void {
	const row = parent.createDiv('bases-tr');
	appendTableCell(row, propertyId, value);
}

function appendTableCell(parent: Element, propertyId: string, value: string): void {
	const cell = parent.createDiv('bases-td');
	cell.dataset.property = propertyId;
	cell.textContent = value;
}

function appendToolbarItem(toolbar: HTMLElement, className: string, label: string): void {
	const item = toolbar.createDiv(`bases-toolbar-item ${className}`);
	const button = item.createEl('button', { cls: 'text-icon-button' });
	button.createSpan({ text: label, cls: 'text-button-label' });
}

function appendPill(parent: Element, spec: PillSpec): void {
	const property = parent.createDiv();
	property.className = 'bases-td';
	property.dataset.property = spec.propertyId;
	const pillElement = property.createDiv();
	pillElement.className = 'multi-select-pill';
	if (spec.title) pillElement.title = spec.title;
	const content = pillElement.createSpan();
	content.className = 'multi-select-pill-content';
	content.textContent = spec.value;
	const remove = pillElement.createEl('button');
	remove.className = 'multi-select-pill-remove-button';
	remove.textContent = '×';
}

function appendGroupHeading(
	parent: Element,
	propertyId: string | null,
	propertyLabel: string,
	value: string,
): HTMLElement {
	const table = parent.querySelector<HTMLElement>('.bases-table')
		?? parent.createDiv('bases-table bases-table-container');
	const heading = table.createDiv('bases-group-heading');
	if (propertyId) heading.dataset.property = propertyId;
	heading.createSpan({ cls: 'bases-group-property', text: propertyLabel });
	heading.createSpan({ cls: 'bases-group-value', text: value });
	return heading;
}

async function mutationCycle(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
}

import type { App, EventRef } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PillEnhancer } from '../src/core/pill-enhancer';
import { SettingsStore } from '../src/core/settings-store';
import { ColorPopover } from '../src/ui/color-popover';

interface Harness {
	root: HTMLElement;
	store: SettingsStore;
	popover: ColorPopover;
	enhancer: PillEnhancer;
}

interface PillSpec {
	propertyId: string;
	value: string;
	inBase?: boolean;
	title?: string;
}

const activeHarnesses: Harness[] = [];

afterEach(() => {
	for (const harness of activeHarnesses.splice(0)) {
		harness.enhancer.stop();
		harness.store.dispose();
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

	it('does not replace left-click and opens a keyboard-operable right-click palette', () => {
		const harness = createHarness([
			{ propertyId: 'note.status', value: 'Done' },
		]);
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
		const swatches = [...document.querySelectorAll<HTMLButtonElement>('.bpc-swatch')];
		expect(swatches).toHaveLength(10);
		expect(document.activeElement).toBe(swatches[0]);
		swatches[0]?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
		);
		expect(document.activeElement).toBe(swatches[1]);
		swatches[1]?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
		);
		expect(document.querySelector('.bpc-popover')).toBeNull();
	});

	it('restores attributes and classes when stopped', () => {
		const harness = createHarness([
			{ propertyId: 'note.status', value: 'Done', title: 'Original' },
		]);
		const target = harness.root.querySelector<HTMLElement>('.multi-select-pill');
		harness.enhancer.stop();
		expect(target?.classList.contains('bpc-pill')).toBe(false);
		expect(target?.getAttribute('title')).toBe('Original');
		expect(target?.style.getPropertyValue('--bpc-bg')).toBe('');
	});

	it('applies ordered cell and row rules and updates them live', () => {
		const harness = createHarness([], (baseView) => appendTableRow(baseView, 'note.status', 'Done'));
		const row = harness.root.querySelector<HTMLElement>('.bases-tr');
		const cell = harness.root.querySelector<HTMLElement>('.bases-td');
		const rowRule = harness.store.addRule('note.status');
		harness.store.updateRule(rowRule.id, { operand: 'done', target: 'row', color: { kind: 'preset', name: 'green' } });
		const cellRule = harness.store.addRule('note.status');
		harness.store.updateRule(cellRule.id, { operand: 'done', target: 'cell', color: { kind: 'preset', name: 'red' } });

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

	it('places one native-style toolbar button before Sort and supports keyboard activation', async () => {
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
		const items = harness.root.querySelectorAll<HTMLElement>('.bpc-conditional-formatting-button');
		const buttons = harness.root.querySelectorAll<HTMLButtonElement>('.bpc-conditional-formatting-button > .text-icon-button');
		expect(items).toHaveLength(1);
		expect(buttons).toHaveLength(1);
		const toolbarItems = [...harness.root.querySelectorAll<HTMLElement>('.bases-toolbar > .bases-toolbar-item')];
		expect(toolbarItems.map((item) => item.classList.contains('bpc-conditional-formatting-button') ? 'Conditional formatting' : item.textContent)).toEqual([
			'Table', '5 results', 'Conditional formatting', 'Sort', 'Filter', 'Properties',
		]);
		expect(buttons[0]?.querySelector('.text-button-label')?.textContent).toBe('Conditional formatting');

		buttons[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		expect(opened).toHaveBeenCalledWith(['note.priority']);
		buttons[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
		expect(opened).toHaveBeenCalledTimes(2);

		items[0]?.remove();
		await mutationCycle();
		expect(harness.root.querySelectorAll('.bpc-conditional-formatting-button')).toHaveLength(1);
		harness.enhancer.stop();
		expect(harness.root.querySelector('.bpc-conditional-formatting-button')).toBeNull();
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
	openRuleManager: (properties: string[]) => void = () => undefined,
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
	const store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
	const popover = new ColorPopover(store);
	const workspace = {
		getLeavesOfType: (type: string) =>
			type === 'bases' ? [{ view: { containerEl: root } }] : [],
		on: () => ({}) as EventRef,
	};
	const enhancer = new PillEnhancer(
		{ workspace } as unknown as App,
		store,
		popover,
		openRuleManager,
	);
	enhancer.start(() => undefined);
	const harness = { root, store, popover, enhancer };
	activeHarnesses.push(harness);
	return harness;
}

function appendTableRow(parent: Element, propertyId: string, value: string): void {
	const row = parent.createDiv('bases-tr');
	const cell = row.createDiv('bases-td');
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

async function mutationCycle(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
}

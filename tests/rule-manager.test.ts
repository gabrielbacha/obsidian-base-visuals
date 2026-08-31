import type { App } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../src/core/settings-store';
import { RuleManagerView } from '../src/ui/rule-manager';

let view: RuleManagerView | null = null;
let store: SettingsStore | null = null;

afterEach(() => {
	view?.unmount();
	store?.dispose();
	view = null;
	store = null;
	document.body.replaceChildren();
});

describe('RuleManagerView', () => {
	it('lays rule fields out in responsive condition and formatting groups without horizontal scrolling', () => {
		store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.discoverProperty('note.status');
		store.addRule('note.status');
		view = new RuleManagerView({} as App, store, [], false);
		const container = document.body.createDiv();
		view.mount(container);

		expect(container.querySelector('.bpc-rule-card__fields-scroll')).toBeNull();
		const groups = [...container.querySelectorAll<HTMLElement>('.bpc-rule-field-group')];
		expect(groups).toHaveLength(2);
		expect(groups.map((group) => group.querySelector('.bpc-rule-field-group__legend')?.textContent))
			.toEqual(['WhenMatch a value', 'ThenApply this format']);
		expect(groups.map((group) => group.getAttribute('role'))).toEqual(['group', 'group']);
		expect(groups.map((group) => group.getAttribute('aria-label')))
			.toEqual(['When: Match a value', 'Then: Apply this format']);
		expect(container.querySelectorAll('.bpc-rule-field')).toHaveLength(8);
		expect(container.querySelectorAll('.bpc-rule-color')).toHaveLength(2);
		expect(container.querySelector<HTMLInputElement>('.bpc-rule-manager__toolbar input')?.placeholder).toBe('Search rules…');
	});

	it('adds an optional font color and can return it to automatic contrast', () => {
		store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.discoverProperty('note.status');
		const rule = store.addRule('note.status');
		view = new RuleManagerView({} as App, store, [], false);
		const container = document.body.createDiv();
		view.mount(container);

		const textColor = container.querySelector<HTMLButtonElement>('.bpc-rule-font-color');
		expect(textColor?.textContent).toContain('Automatic');
		textColor?.click();
		document.querySelector<HTMLButtonElement>('.bpc-rule-color-popover .bpc-swatch[aria-label="Pomegranate"]')?.click();
		expect(store.settings.rules[0]?.fontColor).toEqual({ kind: 'preset', name: 'pomegranate' });

		view.unmount();
		view = new RuleManagerView({} as App, store, [], false);
		view.mount(container);
		container.querySelector<HTMLButtonElement>('.bpc-rule-font-color')?.click();
		document.querySelector<HTMLButtonElement>('.bpc-rule-color-auto')?.click();
		expect(store.settings.rules.find((candidate) => candidate.id === rule.id)?.fontColor).toBeUndefined();
	});

	it('limits fields to the current Base and autocompletes known values', () => {
		store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.discoverProperty('note.other-vault-field');
		store.ensure({ propertyId: 'note.tags', value: 'developers' });
		store.ensure({ propertyId: 'note.tags', value: 'vault owners' });
		store.addRule('note.tags');
		view = new RuleManagerView(
			{} as App,
			store,
			['note.tags'],
			false,
			new Set(['note.tags', 'file.name']),
		);
		const container = document.body.createDiv();
		view.mount(container);

		const propertyOptions = [...container.querySelectorAll<HTMLOptionElement>('select[aria-label="Property"] option')];
		expect(propertyOptions.map((option) => option.value)).toEqual(['note.tags', 'file.name']);
		expect(propertyOptions.map((option) => option.value)).not.toContain('note.other-vault-field');
		const operand = container.querySelector<HTMLInputElement>('input[aria-label="Comparison value"]');
		expect(operand?.getAttribute('list')).toBeTruthy();
		expect([...container.querySelectorAll<HTMLOptionElement>('datalist option')].map((option) => option.value))
			.toEqual(['developers', 'vault owners']);
	});

	it('offers Neutral plus bold and strikethrough treatments', () => {
		store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.discoverProperty('note.status');
		store.addRule('note.status');
		view = new RuleManagerView({} as App, store, [], false);
		const container = document.body.createDiv();
		view.mount(container);

		container.querySelector<HTMLButtonElement>('.bpc-rule-color:not(.bpc-rule-font-color)')?.click();
		document.querySelector<HTMLButtonElement>('.bpc-swatch--neutral')?.click();
		container.querySelector<HTMLButtonElement>('[aria-label="Bold"]')?.click();
		container.querySelector<HTMLButtonElement>('[aria-label="Strikethrough"]')?.click();
		expect(store.settings.rules[0]).toMatchObject({
			color: { kind: 'preset', name: 'default' },
			bold: true,
			strikethrough: true,
		});
	});

	it('edits background opacity live, keeps the palette open, and resets to the color default', () => {
		store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.discoverProperty('note.status');
		store.addRule('note.status');
		view = new RuleManagerView({} as App, store, [], false);
		const container = document.body.createDiv();
		view.mount(container);

		container.querySelector<HTMLButtonElement>('.bpc-rule-color:not(.bpc-rule-font-color)')?.click();
		const panel = document.querySelector<HTMLElement>('.bpc-rule-color-popover');
		const range = panel?.querySelector<HTMLInputElement>('input[type="range"]');
		const number = panel?.querySelector<HTMLInputElement>('.bpc-rule-opacity__number');
		expect(range?.value).toBe('12');
		if (range) range.value = '42';
		range?.dispatchEvent(new Event('input', { bubbles: true }));
		expect(store.settings.rules[0]?.backgroundOpacity).toBe(42);
		expect(number?.value).toBe('42');

		panel?.querySelector<HTMLButtonElement>('.bpc-swatch--neutral')?.click();
		expect(document.querySelector('.bpc-rule-color-popover')).toBe(panel);
		expect(store.settings.rules[0]?.color).toEqual({ kind: 'preset', name: 'default' });
		expect(range?.value).toBe('42');
		panel?.querySelector<HTMLButtonElement>('.bpc-rule-opacity__reset')?.click();
		expect(store.settings.rules[0]?.backgroundOpacity).toBeUndefined();
		expect(range?.value).toBe('3');
	});

	it('drags rules to exact positions and disables dragging while filtering', async () => {
		store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.discoverProperty('note.status');
		const first = store.addRule('note.status');
		const second = store.addRule('note.status');
		const third = store.addRule('note.status');
		store.updateRule(first.id, { name: 'First' });
		store.updateRule(second.id, { name: 'Second' });
		store.updateRule(third.id, { name: 'Third' });
		view = new RuleManagerView({} as App, store, [], false);
		const container = document.body.createDiv();
		view.mount(container);

		const cards = [...container.querySelectorAll<HTMLElement>('.bpc-rule-card')];
		const source = cards[2]?.querySelector<HTMLElement>('.bpc-rule-card__drag-handle');
		const target = cards[0];
		expect(source?.draggable).toBe(true);
		if (target) target.getBoundingClientRect = () => ({
			x: 0, y: 100, left: 0, right: 500, top: 100, bottom: 200,
			width: 500, height: 100, toJSON: () => undefined,
		});
		source?.dispatchEvent(dragEvent('dragstart', 0));
		target?.dispatchEvent(dragEvent('dragover', 110));
		expect(target?.classList.contains('is-drop-before')).toBe(true);
		target?.dispatchEvent(dragEvent('drop', 110));
		expect(store.settings.rules.map((rule) => rule.id)).toEqual([third.id, first.id, second.id]);
		await Promise.resolve();
		expect(container.querySelector('.bpc-rule-reorder-status')?.textContent)
			.toBe('Third moved to position 1 of 3.');

		const search = container.querySelector<HTMLInputElement>('.bpc-rule-manager__toolbar input');
		if (search) search.value = 'First';
		search?.dispatchEvent(new Event('input', { bubbles: true }));
		expect(container.querySelector<HTMLElement>('.bpc-rule-card__drag-handle')?.draggable).toBe(false);
	});

	it('keeps Alt+Arrow and move buttons as accessible ordering paths', async () => {
		store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.discoverProperty('note.status');
		const first = store.addRule('note.status');
		const second = store.addRule('note.status');
		view = new RuleManagerView({} as App, store, [], false);
		const container = document.body.createDiv();
		view.mount(container);
		const secondCard = container.querySelector<HTMLElement>(`[data-rule-id="${second.id}"]`);
		secondCard?.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true,
		}));
		expect(store.settings.rules.map((rule) => rule.id)).toEqual([second.id, first.id]);
		await Promise.resolve();
		expect(container.querySelector('.bpc-rule-reorder-status')?.textContent)
			.toContain('position 1 of 2');
		expect(container.querySelectorAll('button[aria-label^="Move rule"]')).toHaveLength(4);
	});
});

function dragEvent(type: string, clientY: number): Event {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clientY', { value: clientY });
	Object.defineProperty(event, 'dataTransfer', {
		value: {
			effectAllowed: '', dropEffect: '',
			setData: vi.fn(), getData: vi.fn(() => ''),
		},
	});
	return event;
}

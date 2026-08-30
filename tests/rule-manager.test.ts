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
	it('places wide rule fields in a keyboard-focusable horizontal scroll region', () => {
		store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.discoverProperty('note.status');
		store.addRule('note.status');
		view = new RuleManagerView({} as App, store, [], false);
		const container = document.body.createDiv();
		view.mount(container);

		const viewport = container.querySelector<HTMLElement>('.bpc-rule-card__fields-scroll');
		expect(viewport?.tabIndex).toBe(0);
		expect(viewport?.getAttribute('role')).toBe('region');
		expect(viewport?.getAttribute('aria-label')).toBe('New formatting rule fields');
		expect(viewport?.querySelectorAll('.bpc-rule-field')).toHaveLength(6);
		expect(container.querySelector<HTMLInputElement>('.bpc-rule-manager__toolbar input')?.placeholder).toBe('Search rules…');
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

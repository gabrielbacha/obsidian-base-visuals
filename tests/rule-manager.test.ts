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
		expect(viewport?.querySelectorAll('.bpc-rule-field')).toHaveLength(5);
		expect(container.querySelector<HTMLInputElement>('.bpc-rule-manager__toolbar input')?.placeholder).toBe('Search rules…');
	});
});

import type { App } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsStore } from '../src/core/settings-store';
import { ColumnPillPopover } from '../src/ui/column-pill-popover';

const stores: SettingsStore[] = [];
const popovers: ColumnPillPopover[] = [];

afterEach(() => {
	for (const popover of popovers.splice(0)) popover.close();
	for (const store of stores.splice(0)) store.dispose();
	document.body.replaceChildren();
});

describe('ColumnPillPopover', () => {
	it('opens as a compact intent menu without exposing color controls', () => {
		const { popover } = createPopover();
		popover.open(createRequest());
		const panel = document.querySelector('.bpc-column-popover');
		expect(panel?.getAttribute('aria-label')).toBe('Actions for Doing');
		expect(panel?.querySelector('.bpc-context-header .bpc-settings-pill')?.textContent).toBe('Doing');
		expect(menuLabels()).toEqual(['Change color', 'Manage “status” colors', 'Remove from row']);
		expect(panel?.querySelector('.bpc-swatch')).toBeNull();
		expect(panel?.querySelector('input')).toBeNull();
	});

	it('reveals the palette only after Change color and offers a conditional reset', () => {
		const { popover, store } = createPopover();
		popover.open(createRequest());
		findMenuItem('Change color')?.click();
		expect(document.querySelectorAll('.bpc-context-palette .bpc-swatch')).toHaveLength(9);
		document.querySelector<HTMLButtonElement>('.bpc-context-palette [data-preset="pomegranate"]')?.click();
		expect(store.get({ propertyId: 'note.status', value: 'Doing' })?.override).toEqual({ kind: 'preset', name: 'pomegranate' });

		document.querySelector<HTMLButtonElement>('.bpc-context-header__back')?.click();
		expect(menuLabels()).toEqual(['Change color', 'Use property strategy', 'Manage “status” colors', 'Remove from row']);
		findMenuItem('Use property strategy')?.click();
		expect(store.get({ propertyId: 'note.status', value: 'Doing' })?.override).toBeUndefined();
		expect(document.querySelector('.bpc-column-popover')).toBeNull();
	});

	it('shows a separate column view with clickable rows and highlights the source value', () => {
		const { popover, store } = createPopover();
		popover.open(createRequest());
		findMenuItem('Manage “status” colors')?.click();
		const rows = [...document.querySelectorAll<HTMLElement>('.bpc-column-manager__row')];
		expect(rows.map((row) => row.querySelector('.bpc-settings-pill')?.textContent)).toEqual(['Doing', 'Done', 'Later']);
		expect(rows[0]?.classList.contains('is-selected')).toBe(true);
		expect(document.querySelector('.bpc-column-manager__search')).toBeNull();
		expect(document.querySelector('button')?.textContent).not.toContain('Change');

		rows[1]?.click();
		document.querySelector<HTMLButtonElement>('.bpc-context-palette [data-preset="green-sea"]')?.click();
		expect(store.get({ propertyId: 'note.status', value: 'Done' })?.override).toEqual({ kind: 'preset', name: 'green-sea' });
		document.querySelector<HTMLButtonElement>('.bpc-context-header__back')?.click();
		expect(document.querySelectorAll('.bpc-column-manager__row')).toHaveLength(3);
	});

	it('edits the property strategy from the column manager', () => {
		const { popover, store } = createPopover();
		popover.open(createRequest());
		findMenuItem('Manage “status” colors')?.click();
		const strategyTrigger = document.querySelector<HTMLButtonElement>('.bpc-custom-dropdown__trigger[aria-label="Color strategy for status"]');
		expect(strategyTrigger?.textContent).toContain('Smart');
		strategyTrigger?.click();

		const singleOption = document.querySelector<HTMLButtonElement>('.bpc-custom-dropdown__option[data-value="single"]');
		singleOption?.click();
		expect(store.getExplicitPropertyStrategy('note.status')).toEqual({ mode: 'single', preset: 'peter-river' });
		expect(document.querySelectorAll('.bpc-property-strategy__swatch')).toHaveLength(9);
		document.querySelector<HTMLButtonElement>('.bpc-property-strategy__swatch[aria-label="Raspberry"]')?.click();
		expect(store.getExplicitPropertyStrategy('note.status')).toEqual({ mode: 'single', preset: 'raspberry' });
	});

	it('edits pill style independently from the color strategy', () => {
		const { popover, store, saveSettings } = createPopover();
		popover.open(createRequest());
		findMenuItem('Manage “status” colors')?.click();
		const styleTrigger = document.querySelector<HTMLButtonElement>('.bpc-custom-dropdown__trigger[aria-label="Pill style for status"]');
		expect(styleTrigger?.textContent).toContain('Soft');
		styleTrigger?.click();

		const outlineOption = document.querySelector<HTMLButtonElement>('.bpc-custom-dropdown__option[data-value="outline"]');
		outlineOption?.click();
		expect(store.getPropertyStyle('note.status')).toBe('outline');
		expect(saveSettings).toHaveBeenCalledOnce();
		expect(document.querySelector('.bpc-custom-dropdown__menu')).toBeNull();
		expect(styleTrigger?.getAttribute('aria-expanded')).toBe('false');
		expect(store.getExplicitPropertyStrategy('note.status')).toEqual({ mode: 'smart', style: 'outline' });
		expect(document.querySelector('.bpc-column-manager__row .bpc-settings-pill')?.classList.contains('bpc-pill-style-outline')).toBe(true);
	});

	it('adds search only for larger columns and filters the value list', () => {
		const { popover } = createPopover();
		const request = createRequest();
		request.values = ['Doing', 'Done', 'Later', 'Blocked', 'Ready', 'Review', 'Archived'];
		popover.open(request);
		findMenuItem('Manage “status” colors')?.click();
		const search = document.querySelector<HTMLInputElement>('.bpc-column-manager__search');
		expect(search).not.toBeNull();
		if (search) search.value = 'rev';
		search?.dispatchEvent(new Event('input', { bubbles: true }));
		expect(document.querySelectorAll('.bpc-column-manager__row')).toHaveLength(1);
		expect(document.querySelector('.bpc-column-manager__row .bpc-settings-pill')?.textContent).toBe('Review');
	});

	it('resets column overrides with confirmation and removes through the native callback', () => {
		const { popover, store } = createPopover();
		store.setOverride({ propertyId: 'note.status', value: 'Done' }, { kind: 'preset', name: 'green-sea' });
		const request = createRequest();
		popover.open(request);
		findMenuItem('Manage “status” colors')?.click();
		document.querySelector<HTMLButtonElement>('.bpc-column-manager__reset')?.click();
		document.querySelector<HTMLButtonElement>('.modal-content .mod-warning')?.click();
		expect(store.get({ propertyId: 'note.status', value: 'Done' })?.override).toBeUndefined();

		document.querySelector<HTMLButtonElement>('.bpc-context-header__back')?.click();
		findMenuItem('Remove from row')?.click();
		expect(document.querySelector('.bpc-context-header strong')?.textContent).toBe('Remove value?');
		document.querySelector<HTMLButtonElement>('.bpc-remove-confirm .mod-warning')?.click();
		expect(request.removal.remove).toHaveBeenCalledOnce();
		expect(document.querySelector('.bpc-column-popover')).toBeNull();
	});

	it('supports arrow navigation and returning with ArrowLeft', async () => {
		const { popover } = createPopover();
		popover.open(createRequest());
		await Promise.resolve();
		const first = findMenuItem('Change color');
		expect(document.activeElement).toBe(first);
		first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(document.activeElement).toBe(findMenuItem('Manage “status” colors'));
		findMenuItem('Manage “status” colors')?.click();
		document.querySelector('.bpc-column-popover')?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
		);
		expect(menuLabels()).toContain('Change color');
	});

	it('disables removal when the native editor capability is unavailable', () => {
		const { popover } = createPopover();
		const request = createRequest();
		request.removal.available = false;
		popover.open(request);
		const remove = findMenuItem('Remove from row');
		expect(remove?.disabled).toBe(true);
		expect(remove?.title).toContain('installed Obsidian version');
		expect(remove?.getAttribute('aria-description')).toContain('installed Obsidian version');
		remove?.click();
		expect(request.removal.remove).not.toHaveBeenCalled();
	});
});

function menuLabels(): string[] {
	return [...document.querySelectorAll<HTMLElement>('.bpc-context-menu__label')]
		.map((element) => element.textContent ?? '');
}

function findMenuItem(label: string): HTMLButtonElement | undefined {
	return [...document.querySelectorAll<HTMLButtonElement>('.bpc-context-menu__item')]
		.find((button) => button.querySelector('.bpc-context-menu__label')?.textContent === label);
}

function createPopover(): {
	popover: ColumnPillPopover;
	store: SettingsStore;
	saveSettings: ReturnType<typeof vi.fn>;
} {
	const saveSettings = vi.fn(async () => undefined);
	const store = new SettingsStore(SettingsStore.normalize(null), saveSettings);
	const popover = new ColumnPillPopover({} as App, store);
	stores.push(store);
	popovers.push(popover);
	return { popover, store, saveSettings };
}

function createRequest() {
	return {
		document,
		point: { x: 40, y: 40 },
		propertyId: 'note.status',
		value: 'Doing',
		values: ['Doing', 'Done', 'Later'],
		removal: { available: true, remove: vi.fn(() => 'dispatched' as const) },
	};
}

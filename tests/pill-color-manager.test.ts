import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../src/core/settings-store';
import type { ColorPopover } from '../src/ui/color-popover';
import { PillColorManagerView } from '../src/ui/pill-color-manager';

describe('pill color manager cleanup', () => {
	it('confirms before removing only the stale saved values', () => {
		const store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.ensure({ propertyId: 'note.category', value: 'Current' });
		store.ensure({ propertyId: 'note.category', value: 'Deleted' });
		const popover = { close: vi.fn(), openAtElement: vi.fn() } as unknown as ColorPopover;
		const view = new PillColorManagerView(
			{} as App,
			store,
			popover,
			true,
			undefined,
			() => ({
				options: [{ propertyId: 'note.category', value: 'Deleted' }],
				removedProperties: [],
				verifiedProperties: 1,
			}),
		);
		const container = document.body.createDiv();
		view.mount(container);

		container.querySelector<HTMLButtonElement>('.bpc-manager-cleanup')?.click();
		expect(document.querySelector('.modal-container')).not.toBeNull();
		expect(store.get({ propertyId: 'note.category', value: 'Deleted' })).toBeDefined();
		document.querySelector<HTMLButtonElement>('.modal-content .mod-warning')?.click();
		expect(store.get({ propertyId: 'note.category', value: 'Deleted' })).toBeUndefined();
		expect(store.get({ propertyId: 'note.category', value: 'Current' })).toBeDefined();

		view.unmount();
		store.dispose();
		container.remove();
	});

	it('shows and resets only properties allowed by the opened base', () => {
		const store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.ensure({ propertyId: 'note.status', value: 'Done' });
		store.ensure({ propertyId: 'note.other', value: 'Elsewhere' });
		store.setPropertyStyle('note.status', 'solid');
		store.setPropertyStyle('note.other', 'outline');
		const popover = { close: vi.fn(), openAtElement: vi.fn() } as unknown as ColorPopover;
		const view = new PillColorManagerView(
			{} as App, store, popover, true, undefined, undefined, new Set(['note.status']),
		);
		const container = document.body.createDiv();
		view.mount(container);

		expect(container.textContent).toContain('Done');
		expect(container.textContent).not.toContain('Elsewhere');
		container.querySelector<HTMLButtonElement>('.bpc-manager-reset')?.click();
		document.querySelector<HTMLButtonElement>('.modal-content .mod-warning')?.click();
		expect(store.getPropertyStyle('note.status')).toBe('soft');
		expect(store.getPropertyStyle('note.other')).toBe('outline');

		view.unmount();
		store.dispose();
		container.remove();
	});
});

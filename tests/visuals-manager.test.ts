import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../src/core/settings-store';
import type { ColorPopover } from '../src/ui/color-popover';
import { BasesVisualsModal } from '../src/ui/visuals-manager';

describe('Bases visuals manager', () => {
	it('opens on Base-scoped pill colors by default', async () => {
		const store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.ensure({ propertyId: 'note.status', value: 'Done' });
		store.ensure({ propertyId: 'note.other', value: 'Elsewhere' });
		const popover = { close: vi.fn(), openAtElement: vi.fn() } as unknown as ColorPopover;
		const modal = new BasesVisualsModal(
			{} as App,
			store,
			popover,
			['note.status'],
			undefined,
			undefined,
			Promise.resolve(new Set(['note.status'])),
			Promise.resolve(new Set(['note.status', 'file.name'])),
		);
		modal.open();
		await Promise.resolve();
		await Promise.resolve();

		const active = document.querySelector<HTMLElement>('.bpc-visuals-tab.is-active');
		expect(active?.textContent).toBe('Pill colors · 1');
		expect(document.querySelector('.bpc-visuals-panel')?.textContent).toContain('Done');
		expect(document.querySelector('.bpc-visuals-panel')?.textContent).not.toContain('Elsewhere');
		expect(document.querySelector('.bpc-palette-picker__trigger')?.textContent).toContain('Default · Bases Visuals');
		expect(document.querySelectorAll('.bpc-palette-option')).toHaveLength(8);
		document.querySelector<HTMLButtonElement>('.bpc-palette-picker__trigger')?.click();
		expect(document.querySelector<HTMLElement>('.bpc-palette-picker__menu')?.hidden).toBe(false);
		const templates = [...document.querySelectorAll<HTMLButtonElement>('.bpc-palette-option')];
		expect(templates[1]?.querySelectorAll('.bpc-palette-strip__color')).toHaveLength(10);
		templates[1]?.click();
		expect(store.getPaletteTemplateId()).toBe('sunset-spectrum');

		document.querySelectorAll<HTMLButtonElement>('.bpc-visuals-tab')[1]?.click();
		document.querySelector<HTMLButtonElement>('.bpc-rule-manager__toolbar .mod-cta')?.click();
		const properties = [...document.querySelectorAll<HTMLOptionElement>('select[aria-label="Property"] option')]
			.map((option) => option.value);
		expect(properties).toEqual(['note.status', 'file.name']);
		expect(properties).not.toContain('note.other');

		modal.close();
		store.dispose();
	});
});

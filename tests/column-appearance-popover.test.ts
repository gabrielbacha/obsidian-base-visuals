import type { App, WorkspaceLeaf } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColumnAppearancePopover } from '../src/ui/column-appearance-popover';
import type { BaseVisualStoreRepository } from '../src/core/base-visual-store';

afterEach(() => document.body.replaceChildren());

describe('ColumnAppearancePopover', () => {
	it('combines a theme-aware text tone, custom color, and bold emphasis', () => {
		const root = document.body.createDiv('workspace-leaf-content');
		const anchor = root.createEl('button');
		const table = root.createDiv('bases-table-container');
		const values = new Map<string, unknown>();
		const nativeTable = {
			type: 'table',
			containerEl: table,
			config: {
				get: (key: string) => values.get(key),
				set: (key: string, value: unknown) => values.set(key, value),
			},
		};
		const leaf = { view: { containerEl: root, nativeTable } } as unknown as WorkspaceLeaf;
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
		} as unknown as App;
		const changed = vi.fn();
		const { stores, base } = fakeStores();
		const popover = new ColumnAppearancePopover(app, stores);

		popover.open(anchor, root, 'note.status', changed);
		expect(document.querySelector('.bpc-column-appearance-popover')?.textContent)
			.toContain('Column appearance');
		const radios = [...document.querySelectorAll<HTMLButtonElement>('.bpc-column-tone-options [role="radio"]')];
		expect(radios.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1]);
		radios[0]?.focus();
		radios[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		expect(document.activeElement).toBe(radios[3]);
		expect(radios[3]?.getAttribute('aria-checked')).toBe('true');
		expect(document.querySelector<HTMLElement>('.bpc-column-custom-color')?.hidden).toBe(false);
		const faint = findButton('Faint');
		faint?.click();
		expect(base.get('note.status')).toEqual({ tone: 'faint', bold: false });

		const bold = document.querySelector<HTMLButtonElement>('.bpc-column-bold-toggle');
		bold?.click();
		expect(base.get('note.status')).toEqual({ tone: 'faint', bold: true });
		expect(bold?.getAttribute('aria-pressed')).toBe('true');

		findButton('Custom')?.click();
		const hex = document.querySelector<HTMLInputElement>(
			'input[aria-label="Custom column text color hex value"]',
		);
		if (hex) hex.value = '#abc';
		hex?.dispatchEvent(new Event('change', { bubbles: true }));
		expect(base.get('note.status')).toEqual({
			tone: 'custom', bold: true, color: '#AABBCC',
		});
		expect(changed).toHaveBeenCalledTimes(5);
		// A swatch picks one of the shared rule colours in one click.
		document.querySelector<HTMLButtonElement>('.bpc-column-swatch[aria-label="Red"]')?.click();
		expect(base.get('note.status')).toMatchObject({ tone: 'custom', color: '#C62828' });

		// Alignment: set with the style, kept when the tone changes, and cleared by Auto.
		findButton('Center')?.click();
		expect(base.get('note.status')).toMatchObject({ align: 'center' });
		findButton('Muted')?.click();
		expect(base.get('note.status')).toMatchObject({ tone: 'muted', align: 'center' });
		findButton('Auto')?.click();
		expect(base.get('note.status')).not.toHaveProperty('align');

		findButton('Reset appearance')?.click();
		expect(base.has('note.status')).toBe(false);
		// The older per-view key is never written.
		expect(values.has('basesVisualsColumnAppearance')).toBe(false);
		expect(document.querySelector('.bpc-column-appearance-popover')).toBeNull();
	});

	it('defaults new formatting to every Base view and cleanly converts it to a view override', () => {
		const root = document.body.createDiv('workspace-leaf-content');
		const anchor = root.createEl('button');
		const table = root.createDiv('bases-table-container');
		const values = new Map<string, unknown>();
		const nativeTable = {
			type: 'table', containerEl: table,
			config: {
				get: (key: string) => values.get(key),
				set: (key: string, value: unknown) => values.set(key, value),
			},
		};
		const leaf = { view: { containerEl: root, nativeTable } } as unknown as WorkspaceLeaf;
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
		} as unknown as App;
		const { stores, base, view } = fakeStores();
		const popover = new ColumnAppearancePopover(app, stores);

		popover.open(anchor, root, 'note.status', vi.fn());
		const scope = document.querySelector<HTMLInputElement>(
			'input[aria-label="Apply column appearance to all views in this base"]',
		);
		expect(scope?.checked).toBe(true);
		findButton('Faint')?.click();
		expect(base.get('note.status')).toEqual({ tone: 'faint', bold: false });
		expect(view.has('note.status')).toBe(false);

		if (scope) scope.checked = false;
		scope?.dispatchEvent(new Event('change', { bubbles: true }));
		expect(base.has('note.status')).toBe(false);
		expect(view.get('note.status')).toEqual({ tone: 'faint', bold: false });
		expect(values.has('basesVisualsColumnAppearance')).toBe(false);
	});
});

function findButton(label: string): HTMLButtonElement | undefined {
	return [...document.querySelectorAll<HTMLButtonElement>('button')]
		.find((button) => button.textContent?.includes(label));
}

/** A Base and a view block kept in memory, as the plugin's store keeps them in the `.base` file. */
function fakeStores(): { stores: BaseVisualStoreRepository; base: Map<string, unknown>; view: Map<string, unknown> } {
	const base = new Map<string, unknown>();
	const view = new Map<string, unknown>();
	const write = (entries: Map<string, unknown>) => (_scope: HTMLElement, id: string, value: unknown) => {
		if (value === null) entries.delete(id);
		else entries.set(id, value);
		return true;
	};
	const stores = {
		getBaseColumnAppearances: () => Object.fromEntries(base),
		setBaseColumnAppearance: write(base),
		getViewColumnAppearances: () => Object.fromEntries(view),
		setViewColumnAppearance: write(view),
	} as unknown as BaseVisualStoreRepository;
	return { stores, base, view };
}

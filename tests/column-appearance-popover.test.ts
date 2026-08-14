import type { App, WorkspaceLeaf } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColumnAppearancePopover } from '../src/ui/column-appearance-popover';

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
		const popover = new ColumnAppearancePopover(app);

		popover.open(anchor, root, 'note.status', changed);
		expect(document.querySelector('.bpc-column-appearance-popover')?.textContent)
			.toContain('Column appearance');
		const faint = findButton('Faint');
		faint?.click();
		expect(storedAppearance(values)).toEqual({ tone: 'faint', bold: false });

		const bold = document.querySelector<HTMLButtonElement>('.bpc-column-bold-toggle');
		bold?.click();
		expect(storedAppearance(values)).toEqual({ tone: 'faint', bold: true });
		expect(bold?.getAttribute('aria-pressed')).toBe('true');

		findButton('Custom')?.click();
		const hex = document.querySelector<HTMLInputElement>(
			'input[aria-label="Custom column text color hex value"]',
		);
		if (hex) hex.value = '#abc';
		hex?.dispatchEvent(new Event('change', { bubbles: true }));
		expect(storedAppearance(values)).toEqual({
			tone: 'custom', bold: true, color: '#AABBCC',
		});
		expect(changed).toHaveBeenCalledTimes(4);

		findButton('Reset appearance')?.click();
		expect(values.get('basesVisualsColumnAppearance')).toBeNull();
		expect(document.querySelector('.bpc-column-appearance-popover')).toBeNull();
	});
});

function findButton(label: string): HTMLButtonElement | undefined {
	return [...document.querySelectorAll<HTMLButtonElement>('button')]
		.find((button) => button.textContent?.includes(label));
}

function storedAppearance(values: Map<string, unknown>): unknown {
	return (values.get('basesVisualsColumnAppearance') as Record<string, unknown>)?.['note.status'];
}

import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { ResetColumnWidthsConfirmationModal } from '../src/ui/reset-column-widths-confirmation';

describe('ResetColumnWidthsConfirmationModal', () => {
	it('requires confirmation before resetting widths', () => {
		const confirm = vi.fn();
		const modal = new ResetColumnWidthsConfirmationModal({} as App, confirm);
		modal.open();
		expect(confirm).not.toHaveBeenCalled();
		expect(modal.contentEl.textContent).toContain('removes every manual width');
		const action = [...modal.contentEl.querySelectorAll('button')]
			.find((button) => button.textContent === 'Reset widths');
		action?.click();
		expect(confirm).toHaveBeenCalledOnce();
	});
});

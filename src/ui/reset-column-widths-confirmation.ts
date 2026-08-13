import { App, Modal } from 'obsidian';

export class ResetColumnWidthsConfirmationModal extends Modal {
	constructor(app: App, private readonly onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Reset all column widths?');
		this.contentEl.createEl('p', {
			text: 'This removes every manual width from the current view. Obsidian will return to automatic column sizing.',
		});
		const actions = this.contentEl.createDiv('bpc-confirm-modal__actions');
		actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } })
			.addEventListener('click', () => this.close());
		const reset = actions.createEl('button', {
			text: 'Reset widths',
			cls: 'mod-warning',
			attr: { type: 'button' },
		});
		reset.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});
		reset.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

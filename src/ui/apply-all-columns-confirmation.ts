import { App, Modal } from 'obsidian';

interface ApplyAllColumnsConfirmationOptions {
	width: number;
	layoutName?: string;
	rowHeightLabel?: string;
	onConfirm: () => void;
}

export class ApplyAllColumnsConfirmationModal extends Modal {
	constructor(app: App, private readonly options: ApplyAllColumnsConfirmationOptions) {
		super(app);
	}

	onOpen(): void {
		const { width, layoutName, rowHeightLabel, onConfirm } = this.options;
		this.setTitle(layoutName ? `Apply “${layoutName}” to all columns?` : 'Apply width to all columns?');
		this.contentEl.createEl('p', {
			text: layoutName
				? `This will apply ${rowHeightLabel ?? 'the saved row height'} and replace every manual column width in the current view with ${width} px.`
				: `This will replace every manual column width in the current view with ${width} px.`,
		});
		const actions = this.contentEl.createDiv('bpc-confirm-modal__actions');
		actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } })
			.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: layoutName ? 'Apply layout' : 'Apply to all',
			cls: 'mod-cta',
			attr: { type: 'button' },
		});
		confirm.addEventListener('click', () => {
			onConfirm();
			this.close();
		});
		confirm.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

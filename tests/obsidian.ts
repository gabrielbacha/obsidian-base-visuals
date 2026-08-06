export class Modal {
	readonly modalEl = document.body.createDiv('modal-container');
	readonly contentEl = this.modalEl.createDiv('modal-content');

	setTitle(title: string): void {
		this.modalEl.dataset.title = title;
	}

	open(): void {
		(this as { onOpen?: () => void }).onOpen?.();
	}

	close(): void {
		(this as { onClose?: () => void }).onClose?.();
		this.modalEl.remove();
	}
}

export function setIcon(element: HTMLElement, icon: string): void {
	const svg = element.createSvg('svg');
	svg.setAttribute('data-icon', icon);
	svg.setAttribute('aria-hidden', 'true');
}

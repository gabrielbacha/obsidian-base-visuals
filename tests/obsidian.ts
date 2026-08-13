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

export class MenuItem {
	readonly element = document.body.createEl('button');
	private callback: ((event: MouseEvent | KeyboardEvent) => unknown) | null = null;

	setTitle(title: string): this {
		this.element.textContent = title;
		return this;
	}

	setChecked(checked: boolean | null): this {
		this.element.setAttribute('aria-checked', String(Boolean(checked)));
		return this;
	}

	onClick(callback: (event: MouseEvent | KeyboardEvent) => unknown): this {
		this.callback = callback;
		this.element.addEventListener('click', (event) => this.callback?.(event));
		return this;
	}
}

export class Menu {
	readonly menuEl = document.createDiv('menu');
	private hideCallback: (() => unknown) | null = null;

	setUseNativeMenu(): this {
		return this;
	}

	addItem(callback: (item: MenuItem) => unknown): this {
		const item = new MenuItem();
		callback(item);
		this.menuEl.appendChild(item.element);
		return this;
	}

	onHide(callback: () => unknown): void {
		this.hideCallback = callback;
	}

	showAtPosition(): this {
		document.body.appendChild(this.menuEl);
		return this;
	}

	close(): void {
		this.menuEl.remove();
		this.hideCallback?.();
	}
}

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

export class Notice {
	constructor(public readonly message: string) {}
}

export abstract class AbstractInputSuggest<T> {
	limit = 100;
	private container: HTMLElement | null = null;
	private renderRevision = 0;
	private readonly callbacks: Array<(value: T, event: MouseEvent | KeyboardEvent) => unknown> = [];

	constructor(_app: unknown, private readonly input: HTMLInputElement | HTMLDivElement) {
		input.addEventListener('input', () => void this.render());
		input.addEventListener('focus', () => void this.render());
	}

	protected abstract getSuggestions(query: string): T[] | Promise<T[]>;
	abstract renderSuggestion(value: T, element: HTMLElement): void;

	setValue(value: string): void {
		if (this.input instanceof HTMLInputElement) this.input.value = value;
		else this.input.textContent = value;
	}

	getValue(): string {
		return this.input instanceof HTMLInputElement ? this.input.value : this.input.textContent ?? '';
	}

	onSelect(callback: (value: T, event: MouseEvent | KeyboardEvent) => unknown): this {
		this.callbacks.push(callback);
		return this;
	}

	selectSuggestion(value: T, event: MouseEvent | KeyboardEvent): void {
		for (const callback of this.callbacks) callback(value, event);
		this.close();
	}

	open(): void {
		void this.render();
	}

	close(): void {
		this.renderRevision += 1;
		this.container?.remove();
		this.container = null;
	}

	private async render(): Promise<void> {
		const revision = this.renderRevision + 1;
		this.renderRevision = revision;
		this.container?.remove();
		this.container = null;
		const suggestions = (await this.getSuggestions(this.getValue())).slice(0, this.limit || undefined);
		if (revision !== this.renderRevision) return;
		if (!suggestions.length) return;
		const container = document.body.createDiv('suggestion-container');
		for (const suggestion of suggestions) {
			const item = container.createDiv('suggestion-item');
			this.renderSuggestion(suggestion, item);
			item.addEventListener('click', (event) => this.selectSuggestion(suggestion, event));
		}
		this.container = container;
	}
}

export function setIcon(element: HTMLElement, icon: string): void {
	const svg = element.createSvg('svg');
	svg.setAttribute('data-icon', icon);
	svg.setAttribute('aria-hidden', 'true');
}

export function parseYaml(source: string): unknown {
	return JSON.parse(source) as unknown;
}

export function stringifyYaml(value: unknown): string {
	return JSON.stringify(value, null, 2);
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

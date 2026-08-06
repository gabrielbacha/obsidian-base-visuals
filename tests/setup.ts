type ElementOptions =
	| string
	| {
			text?: string;
			cls?: string | string[];
			attr?: Record<string, string | number | boolean | null>;
	  };

Node.prototype.createEl = function createEl<
	K extends keyof HTMLElementTagNameMap,
>(tag: K, options?: ElementOptions): HTMLElementTagNameMap[K] {
	const doc = this.ownerDocument ?? document;
	const element = doc.createElement(tag);
	applyOptions(element, options);
	this.appendChild(element);
	return element;
};

Node.prototype.createDiv = function createDiv(
	options?: ElementOptions,
): HTMLDivElement {
	return this.createEl('div', options);
};

Node.prototype.createSpan = function createSpan(
	options?: ElementOptions,
): HTMLSpanElement {
	return this.createEl('span', options);
};

Node.prototype.createSvg = function createSvg<
	K extends keyof SVGElementTagNameMap,
>(tag: K, options?: ElementOptions): SVGElementTagNameMap[K] {
	const doc = this.ownerDocument ?? document;
	const element = doc.createElementNS('http://www.w3.org/2000/svg', tag);
	applyOptions(element as unknown as HTMLElement, options);
	this.appendChild(element);
	return element;
};

HTMLElement.prototype.empty = function empty(): void {
	this.replaceChildren();
};

function applyOptions(element: HTMLElement, options?: ElementOptions): void {
	if (typeof options === 'string') {
		element.className = options;
		return;
	}
	if (!options) return;
	if (options.text !== undefined) element.textContent = options.text;
	if (typeof options.cls === 'string') element.className = options.cls;
	else if (options.cls) element.classList.add(...options.cls);
	for (const [name, value] of Object.entries(options.attr ?? {})) {
		if (value !== null) element.setAttribute(name, String(value));
	}
}

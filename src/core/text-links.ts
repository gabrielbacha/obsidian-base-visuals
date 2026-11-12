/**
 * Makes the web addresses inside a Base's text cells open on a click or tap.
 *
 * Obsidian shows a text value as an editable element, so a URL in a longer value is plain text and
 * a click on it starts editing. The text is never changed here: each URL is marked with the CSS
 * Custom Highlight API, and a click or tap that lands on one opens it instead of editing. A click
 * anywhere else in the text still edits it, and an element being edited shows no links.
 */

const TEXT_SELECTOR = '.metadata-input-longtext';
const CELL_SELECTOR = '.bases-td[data-property], .bases-table-cell[data-property]';
const BASE_SCOPE_SELECTOR = '.bases-view, .bases-embed';
export const TEXT_URL_HIGHLIGHT = 'bpc-text-url';
const HOVER_CLASS = 'bpc-text-url-hover';
/** A tap is a touch that moves less than this many pixels. */
const TAP_SLOP = 10;
const TAP_MAX_MS = 600;

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/giu;

export interface TextUrl {
	url: string;
	start: number;
	end: number;
}

/** The URLs in `text`, without the punctuation that ends a sentence or closes a bracket. */
export function findTextUrls(text: string): TextUrl[] {
	const urls: TextUrl[] = [];
	for (const match of text.matchAll(URL_PATTERN)) {
		let url = match[0];
		while (/[.,;:!?'")\]}>]$/u.test(url)) {
			const last = url.slice(-1);
			const open = ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[last];
			if (open && count(url, open) >= count(url, last)) break;
			url = url.slice(0, -1);
		}
		if (/^https?:\/\/[^/?#]/iu.test(url)) urls.push({ url, start: match.index, end: match.index + url.length });
	}
	return urls;
}

function count(text: string, character: string): number {
	return text.split(character).length - 1;
}

interface RootListeners {
	mouseDown: (event: MouseEvent) => void;
	click: (event: MouseEvent) => void;
	touchStart: (event: TouchEvent) => void;
	touchEnd: (event: TouchEvent) => void;
	pointerMove: (event: PointerEvent) => void;
	focusChange: (event: FocusEvent) => void;
}

type HighlightRegistry = Map<string, Highlight>;

export class TextLinks {
	private readonly roots = new Map<HTMLElement, RootListeners>();
	private readonly rangesByText = new Map<HTMLElement, Range[]>();
	private readonly textsByCell = new Map<HTMLElement, Set<HTMLElement>>();
	private readonly cellByText = new WeakMap<HTMLElement, HTMLElement>();
	private readonly sourceByText = new WeakMap<HTMLElement, string>();
	private readonly highlights = new Map<Document, Highlight>();
	private touch: { x: number; y: number; time: number } | null = null;

	constructor(private readonly open: (url: string) => void = (url) => window.open(url)) {}

	attach(root: HTMLElement): void {
		if (this.roots.has(root)) return;
		const listeners: RootListeners = {
			mouseDown: (event) => {
				// Keeps the text from taking focus (and a caret) when the press lands on a URL.
				if (event.button === 0 && this.urlAt(event.target, event.clientX, event.clientY)) event.preventDefault();
			},
			click: (event) => {
				if (event.button !== 0) return;
				const url = this.urlAt(event.target, event.clientX, event.clientY);
				if (!url) return;
				event.preventDefault();
				event.stopPropagation();
				this.open(url);
			},
			touchStart: (event) => {
				const point = event.touches.length === 1 ? event.touches[0] : undefined;
				this.touch = point ? { x: point.clientX, y: point.clientY, time: event.timeStamp } : null;
			},
			touchEnd: (event) => {
				const start = this.touch;
				this.touch = null;
				const point = event.changedTouches[0];
				if (!start || !point || event.touches.length) return;
				if (Math.hypot(point.clientX - start.x, point.clientY - start.y) > TAP_SLOP) return;
				if (event.timeStamp - start.time > TAP_MAX_MS) return;
				const url = this.urlAt(event.target, point.clientX, point.clientY);
				if (!url) return;
				// Cancels the mouse events and the focus a tap would start, so the keyboard stays closed.
				event.preventDefault();
				event.stopPropagation();
				this.open(url);
			},
			pointerMove: (event) => {
				if (event.pointerType !== 'mouse') return;
				const text = this.idleText(event.target);
				if (!text) return;
				text.classList.toggle(HOVER_CLASS, Boolean(this.urlAt(text, event.clientX, event.clientY)));
			},
			focusChange: (event) => {
				const text = textOf(event.target);
				if (text) this.update(text);
			},
		};
		root.addEventListener('mousedown', listeners.mouseDown, true);
		root.addEventListener('click', listeners.click, true);
		root.addEventListener('touchstart', listeners.touchStart, { capture: true, passive: true });
		root.addEventListener('touchend', listeners.touchEnd, { capture: true, passive: false });
		root.addEventListener('pointermove', listeners.pointerMove, { capture: true, passive: true });
		root.addEventListener('focusin', listeners.focusChange, true);
		root.addEventListener('focusout', listeners.focusChange, true);
		this.roots.set(root, listeners);
	}

	detach(root: HTMLElement): void {
		const listeners = this.roots.get(root);
		if (!listeners) return;
		root.removeEventListener('mousedown', listeners.mouseDown, true);
		root.removeEventListener('click', listeners.click, true);
		root.removeEventListener('touchstart', listeners.touchStart, true);
		root.removeEventListener('touchend', listeners.touchEnd, true);
		root.removeEventListener('pointermove', listeners.pointerMove, true);
		root.removeEventListener('focusin', listeners.focusChange, true);
		root.removeEventListener('focusout', listeners.focusChange, true);
		this.roots.delete(root);
		for (const [cell] of this.textsByCell) if (root.contains(cell)) this.forgetCell(cell);
	}

	/** Marks the URLs of a cell's text again, after its value or focus changed. */
	updateCell(cell: HTMLElement): void {
		const current = new Set(cell.querySelectorAll<HTMLElement>(TEXT_SELECTOR));
		for (const tracked of this.textsByCell.get(cell) ?? []) if (!current.has(tracked) || !tracked.isConnected) this.forget(tracked);
		for (const text of current) this.update(text);
	}

	forgetCell(cell: HTMLElement): void {
		for (const text of [...(this.textsByCell.get(cell) ?? [])]) this.forget(text);
		this.textsByCell.delete(cell);
	}
	/** One detached-node pass per DOM mutation batch, never per updated cell. */
	pruneDisconnected(): void {
		for (const [cell] of this.textsByCell) if (!cell.isConnected) this.forgetCell(cell);
	}

	dispose(): void {
		for (const root of [...this.roots.keys()]) this.detach(root);
		for (const text of [...this.rangesByText.keys()]) this.forget(text);
		for (const [doc] of this.highlights) highlightRegistry(doc)?.delete(TEXT_URL_HIGHLIGHT);
		this.highlights.clear();
		this.textsByCell.clear();
	}

	private update(text: HTMLElement): void {
		if (text.isConnected && !isEditing(text) && this.rangesByText.has(text) && this.sourceByText.get(text) === text.textContent) return;
		this.forget(text);
		if (!text.isConnected || isEditing(text) || !text.closest(BASE_SCOPE_SELECTOR)) return;
		const highlight = this.highlightFor(text.ownerDocument);
		const ranges: Range[] = [];
		for (const node of textNodes(text)) {
			for (const { start, end } of findTextUrls(node.data)) {
				const range = text.ownerDocument.createRange();
				range.setStart(node, start);
				range.setEnd(node, end);
				ranges.push(range);
				highlight?.add(range);
			}
		}
		const cell = text.closest<HTMLElement>(CELL_SELECTOR);
		if (cell) {
			const texts = this.textsByCell.get(cell) ?? new Set<HTMLElement>();
			texts.add(text); this.textsByCell.set(cell, texts); this.cellByText.set(text, cell);
		}
		this.sourceByText.set(text, text.textContent ?? "");
		if (ranges.length) this.rangesByText.set(text, ranges);
	}

	private forget(text: HTMLElement): void {
		text.classList.remove(HOVER_CLASS);
		const ranges = this.rangesByText.get(text);
		const cell = this.cellByText.get(text);
		if (cell) { const texts = this.textsByCell.get(cell); texts?.delete(text); if (!texts?.size) this.textsByCell.delete(cell); }
		this.cellByText.delete(text); this.sourceByText.delete(text);
		if (!ranges) return;
		const highlight = this.highlights.get(text.ownerDocument);
		for (const range of ranges) highlight?.delete(range);
		this.rangesByText.delete(text);
	}

	private highlightFor(doc: Document): Highlight | null {
		const existing = this.highlights.get(doc);
		if (existing) return existing;
		const registry = highlightRegistry(doc);
		const HighlightClass = (doc.defaultView as (Window & { Highlight?: typeof Highlight }) | null)?.Highlight;
		if (!registry || !HighlightClass) return null;
		const highlight = new HighlightClass();
		registry.set(TEXT_URL_HIGHLIGHT, highlight);
		this.highlights.set(doc, highlight);
		return highlight;
	}

	/** The text element under an event, when it shows its value and is not being edited. */
	private idleText(target: EventTarget | null): HTMLElement | null {
		const text = textOf(target);
		return text && !isEditing(text) && text.closest(BASE_SCOPE_SELECTOR) ? text : null;
	}

	/** The URL drawn at a point of an idle text element, if the point is on its characters. */
	private urlAt(target: EventTarget | null, x: number, y: number): string | null {
		const text = this.idleText(target);
		if (!text) return null;
		const ranges = this.rangesByText.get(text);
		if (!ranges?.length) return null;
		for (const range of ranges) {
			for (const rect of range.getClientRects()) {
				if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
					return findTextUrls(range.toString())[0]?.url ?? null;
				}
			}
		}
		return null;
	}
}

function textOf(target: EventTarget | null): HTMLElement | null {
	const node = target as Node | null;
	const element = node && typeof node === "object" && typeof node.nodeType === "number" ? (node.nodeType === 1 ? node as Element : node.parentElement) : null;
	if (!element || typeof element.closest !== "function") return null;
	const text = element?.closest<HTMLElement>(TEXT_SELECTOR);
	return text?.closest(CELL_SELECTOR) ? text : null;
}

function isEditing(text: HTMLElement): boolean {
	const active = text.ownerDocument.activeElement;
	return Boolean(active && (active === text || text.contains(active)));
}

function textNodes(root: HTMLElement): Text[] {
	const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
	const nodes: Text[] = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
	return nodes;
}

function highlightRegistry(doc: Document): HighlightRegistry | null {
	const css = (doc.defaultView as (Window & { CSS?: { highlights?: HighlightRegistry } }) | null)?.CSS;
	return css?.highlights ?? null;
}

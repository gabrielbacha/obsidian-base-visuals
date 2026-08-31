import { setIcon, type App } from 'obsidian';
import {
	getNativeColumnWrapMode,
	getNativeTextWrapping,
	ROW_CONTENT_MODES,
	setNativeColumnWrapMode,
	type ColumnWrapMode,
} from '../core/native-table-view';
import { bindRadioGroup } from './radio-group';

export class ColumnWrappingPopover {
	private panel: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;

	constructor(private readonly app: App) {}

	open(
		anchor: HTMLElement,
		scope: HTMLElement,
		propertyId: string,
		displayName: string,
		onChange: () => void,
	): void {
		this.close();
		const doc = anchor.ownerDocument;
		const anchorRect = snapshotRect(anchor.getBoundingClientRect());
		const panel = doc.body.createDiv('bpc-column-wrapping-popover');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', `Text wrapping for ${displayName}`);
		this.panel = panel;

		const header = panel.createDiv('bpc-column-wrapping__header');
		const title = header.createDiv();
		title.createEl('strong', { text: 'Text wrapping' });
		title.createSpan({ text: displayName });
		const close = header.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': 'Close text wrapping' },
		});
		setIcon(close, 'x');
		close.addEventListener('click', () => this.close());

		const section = panel.createDiv('bpc-column-wrapping__section');
		const group = section.createDiv('bpc-column-wrapping-options');
		group.setAttribute('role', 'radiogroup');
		group.setAttribute('aria-label', `Text wrapping for ${displayName}`);
		const inherited = getNativeTextWrapping(this.app, scope).mode;
		let current = getNativeColumnWrapMode(this.app, scope, propertyId);
		const options: Array<{ value: ColumnWrapMode; label: string; detail: string }> = [
			{ value: 'inherit', label: 'Use table setting', detail: `Currently ${modeLabel(inherited)}` },
			...ROW_CONTENT_MODES.map((option) => ({
				value: option.value,
				label: option.label,
				detail: option.description,
			})),
		];
		const buttons = options.map((option) => {
			const button = group.createEl('button', {
				attr: { type: 'button', role: 'radio' },
			});
			button.setAttribute('aria-checked', String(option.value === current));
			const icon = button.createSpan('bpc-column-wrapping-option__icon');
			setIcon(icon, option.value === 'truncate'
				? 'text-cursor-input'
				: option.value === 'stack' ? 'rows-3' : option.value === 'wrap' ? 'wrap-text' : 'undo-2');
			const copy = button.createSpan('bpc-column-wrapping-option__copy');
			copy.createEl('strong', { text: option.label });
			copy.createSpan({ text: option.detail });
			const check = button.createSpan('bpc-column-wrapping-option__check');
			setIcon(check, 'check');
			button.addEventListener('click', () => {
				current = option.value;
				setNativeColumnWrapMode(this.app, scope, propertyId, option.value);
				for (const candidate of buttons) {
					candidate.setAttribute('aria-checked', String(candidate === button));
				}
				onChange();
			});
			return button;
		});
		bindRadioGroup(group, buttons);

		const dismiss = (event: PointerEvent) => {
			if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) this.close();
		};
		const changeNativeMenuItem = (event: PointerEvent) => {
			const item = (event.target as Element | null)?.closest?.('.menu-item');
			if (item && item !== anchor && !panel.contains(item)) this.close();
		};
		const keydown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			this.close();
			anchor.focus();
		};
		doc.addEventListener('pointerdown', dismiss, true);
		doc.addEventListener('pointerover', changeNativeMenuItem, true);
		panel.addEventListener('keydown', keydown);
		this.cleanup = () => {
			doc.removeEventListener('pointerdown', dismiss, true);
			doc.removeEventListener('pointerover', changeNativeMenuItem, true);
			panel.removeEventListener('keydown', keydown);
			anchor.classList.remove('selected');
			panel.remove();
		};
		positionPopover(panel, doc, anchorRect);
		queueMicrotask(() => buttons.find((button) =>
			button.getAttribute('aria-checked') === 'true')?.focus());
	}

	close(): void {
		this.cleanup?.();
		this.cleanup = null;
		this.panel = null;
	}
}

export function describeColumnWrapping(
	app: App,
	scope: HTMLElement,
	propertyId: string,
): string {
	const mode = getNativeColumnWrapMode(app, scope, propertyId);
	return mode === 'inherit' ? `Table · ${modeLabel(getNativeTextWrapping(app, scope).mode)}` : modeLabel(mode);
}

function modeLabel(mode: Exclude<ColumnWrapMode, 'inherit'>): string {
	return ROW_CONTENT_MODES.find((option) => option.value === mode)?.label ?? 'Truncate';
}

interface AnchorRect {
	left: number;
	right: number;
	top: number;
}

function snapshotRect(rect: DOMRect): AnchorRect {
	return { left: rect.left, right: rect.right, top: rect.top };
}

function positionPopover(panel: HTMLElement, doc: Document, rect: AnchorRect): void {
	const win = doc.defaultView;
	const viewportWidth = win?.innerWidth ?? doc.documentElement.clientWidth;
	const viewportHeight = win?.innerHeight ?? doc.documentElement.clientHeight;
	const width = Math.min(340, viewportWidth - 24);
	panel.style.width = `${width}px`;
	const panelHeight = Math.min(panel.offsetHeight || 320, viewportHeight - 24);
	const right = Math.max(12, rect.right + 6);
	const left = right + width <= viewportWidth - 12
		? right
		: Math.max(12, rect.left - width - 6);
	panel.style.left = `${left}px`;
	panel.style.top = `${Math.max(12, Math.min(rect.top, viewportHeight - panelHeight - 12))}px`;
}

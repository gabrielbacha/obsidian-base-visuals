import { setIcon, type App } from 'obsidian';
import { normalizeHex } from '../core/colors';
import {
	DEFAULT_COLUMN_APPEARANCE,
	getNativeColumnAppearance,
	setNativeColumnAppearance,
	type ColumnTextTone,
	type NativeColumnAppearance,
} from '../core/native-table-view';
import { displayPropertyName } from './color-popover';

export class ColumnAppearancePopover {
	private panel: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;

	constructor(private readonly app: App) {}

	open(
		anchor: HTMLElement,
		scope: HTMLElement,
		propertyId: string,
		onChange: () => void,
	): void {
		this.close();
		const doc = anchor.ownerDocument;
		const panel = doc.body.createDiv('bpc-column-appearance-popover');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', `Column appearance for ${displayPropertyName(propertyId)}`);
		this.panel = panel;

		const header = panel.createDiv('bpc-column-appearance__header');
		const title = header.createDiv();
		title.createEl('strong', { text: 'Column appearance' });
		title.createSpan({ text: displayPropertyName(propertyId) });
		const close = header.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': 'Close column appearance' },
		});
		setIcon(close, 'x');
		close.addEventListener('click', () => this.close());

		let appearance = getNativeColumnAppearance(this.app, scope, propertyId);
		const commit = (next: NativeColumnAppearance) => {
			appearance = next;
			setNativeColumnAppearance(this.app, scope, propertyId, next);
			onChange();
		};

		const toneSection = panel.createDiv('bpc-column-appearance__section');
		toneSection.createDiv({ cls: 'bpc-column-appearance__label', text: 'Text color' });
		const toneGroup = toneSection.createDiv('bpc-column-tone-options');
		toneGroup.setAttribute('role', 'radiogroup');
		toneGroup.setAttribute('aria-label', 'Column text color');
		const tones: Array<{ tone: ColumnTextTone; label: string; detail: string }> = [
			{ tone: 'default', label: 'Default', detail: 'Normal contrast' },
			{ tone: 'muted', label: 'Muted', detail: 'Secondary information' },
			{ tone: 'faint', label: 'Faint', detail: 'Background context' },
			{ tone: 'custom', label: 'Custom', detail: 'Choose a color' },
		];
		const toneButtons = tones.map(({ tone, label, detail }) => {
			const button = toneGroup.createEl('button', {
				cls: `bpc-column-tone-option mod-${tone}`,
				attr: { type: 'button', role: 'radio' },
			});
			button.setAttribute('aria-checked', String(appearance.tone === tone));
			button.createSpan('bpc-column-tone-option__sample').textContent = 'Aa';
			const copy = button.createSpan('bpc-column-tone-option__copy');
			copy.createEl('strong', { text: label });
			copy.createSpan({ text: detail });
			button.addEventListener('click', () => {
				const next = tone === 'custom'
					? { ...appearance, tone, color: appearance.color ?? '#787774' } as NativeColumnAppearance
					: { tone, bold: appearance.bold } as NativeColumnAppearance;
				commit(next);
				for (const candidate of toneButtons) {
					candidate.setAttribute('aria-checked', String(candidate === button));
				}
				customRow.hidden = tone !== 'custom';
				if (tone === 'custom') hexInput.focus();
			});
			return button;
		});

		const customRow = toneSection.createDiv('bpc-column-custom-color');
		customRow.hidden = appearance.tone !== 'custom';
		const picker = customRow.createEl('input', {
			type: 'color',
			attr: { 'aria-label': 'Custom column text color' },
		});
		picker.value = appearance.color ?? '#787774';
		const hexInput = customRow.createEl('input', {
			type: 'text',
			value: appearance.color ?? '#787774',
			attr: {
				'aria-label': 'Custom column text color hex value',
				maxlength: '7',
				spellcheck: 'false',
			},
		});
		const applyCustom = (value: string) => {
			const color = normalizeHex(value);
			if (!color) {
				hexInput.setAttribute('aria-invalid', 'true');
				return;
			}
			hexInput.removeAttribute('aria-invalid');
			hexInput.value = color;
			picker.value = color;
			commit({ tone: 'custom', bold: appearance.bold, color });
		};
		picker.addEventListener('input', () => applyCustom(picker.value));
		hexInput.addEventListener('change', () => applyCustom(hexInput.value));

		const emphasisSection = panel.createDiv('bpc-column-appearance__section');
		emphasisSection.createDiv({ cls: 'bpc-column-appearance__label', text: 'Emphasis' });
		const bold = emphasisSection.createEl('button', {
			cls: 'bpc-column-bold-toggle',
			attr: { type: 'button' },
		});
		bold.setAttribute('aria-pressed', String(appearance.bold));
		const boldIcon = bold.createSpan('bpc-column-bold-toggle__icon');
		setIcon(boldIcon, 'bold');
		const boldCopy = bold.createSpan('bpc-column-bold-toggle__copy');
		boldCopy.createEl('strong', { text: 'Bold column' });
		boldCopy.createSpan({ text: 'Emphasize this field' });
		const check = bold.createSpan('bpc-column-bold-toggle__check');
		setIcon(check, 'check');
		bold.addEventListener('click', () => {
			commit({ ...appearance, bold: !appearance.bold });
			bold.setAttribute('aria-pressed', String(appearance.bold));
		});

		const footer = panel.createDiv('bpc-column-appearance__footer');
		const reset = footer.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button' },
		});
		const resetIcon = reset.createSpan();
		setIcon(resetIcon, 'rotate-ccw');
		reset.createSpan({ text: 'Reset appearance' });
		reset.addEventListener('click', () => {
			commit({ ...DEFAULT_COLUMN_APPEARANCE });
			this.close();
		});

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
		positionPopover(panel, anchor);
		queueMicrotask(() => toneButtons.find((button) =>
			button.getAttribute('aria-checked') === 'true')?.focus());
	}

	close(): void {
		this.cleanup?.();
		this.cleanup = null;
		this.panel = null;
	}
}

function positionPopover(panel: HTMLElement, anchor: HTMLElement): void {
	const rect = anchor.getBoundingClientRect();
	const win = anchor.ownerDocument.defaultView;
	const viewportWidth = win?.innerWidth ?? document.documentElement.clientWidth;
	const viewportHeight = win?.innerHeight ?? document.documentElement.clientHeight;
	const width = Math.min(320, viewportWidth - 24);
	panel.style.width = `${width}px`;
	const panelHeight = Math.min(panel.offsetHeight || 480, viewportHeight - 24);
	const right = Math.max(12, rect.right + 6);
	const left = right + width <= viewportWidth - 12
		? right
		: Math.max(12, rect.left - width - 6);
	panel.style.left = `${left}px`;
	panel.style.top = `${Math.max(12, Math.min(rect.top, viewportHeight - panelHeight - 12))}px`;
}

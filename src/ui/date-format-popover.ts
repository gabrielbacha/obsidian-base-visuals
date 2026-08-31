import { setIcon, type App } from 'obsidian';
import { DATE_FORMAT_PRESETS, dateFormatPreview, isValidDateFormat } from '../core/date-format';
import { getNativeDateFormat, setNativeDateFormat } from '../core/native-table-view';
import { bindRadioGroup } from './radio-group';

const CUSTOM_FALLBACK = 'DD MMM YYYY';

export class DateFormatPopover {
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
		const panel = doc.body.createDiv('bpc-date-format-popover');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', `Date format for ${displayName}`);
		this.panel = panel;

		const header = panel.createDiv('bpc-date-format__header');
		const heading = header.createDiv();
		heading.createEl('strong', { text: 'Date format' });
		heading.createSpan({ text: displayName });
		const close = header.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': 'Close date format' },
		});
		setIcon(close, 'x');
		close.addEventListener('click', () => this.close());

		let current = getNativeDateFormat(this.app, scope, propertyId);
		const presetFormats = new Set<string>(DATE_FORMAT_PRESETS.map((preset) => preset.format));
		const options = panel.createDiv('bpc-date-format__options');
		options.setAttribute('role', 'radiogroup');
		options.setAttribute('aria-label', 'Date format');
		const customRow = panel.createDiv('bpc-date-format__custom');
		const customInput = customRow.createEl('input', {
			type: 'text',
			value: current && !presetFormats.has(current) ? current : CUSTOM_FALLBACK,
			attr: {
				'aria-label': 'Custom date format',
				maxlength: '48',
				autocomplete: 'off',
				spellcheck: 'false',
			},
		});
		const customPreview = customRow.createDiv('bpc-date-format__preview');
		const customError = customRow.createDiv('bpc-date-format__error');
		customError.setAttribute('aria-live', 'polite');

		const choices: Array<{ value: string; label: string; detail: string }> = [
			{ value: '', label: 'Default', detail: 'Use Obsidian’s native display' },
			...DATE_FORMAT_PRESETS.map((preset) => ({
				value: preset.format,
				label: dateFormatPreview(preset.format),
				detail: preset.format,
			})),
			{ value: 'custom', label: 'Custom', detail: 'Use a date pattern' },
		];
		const selectedValue = current && !presetFormats.has(current) ? 'custom' : current;
		const commit = (format: string): void => {
			current = format;
			setNativeDateFormat(this.app, scope, propertyId, format);
			onChange();
		};
		const buttons = choices.map((choice) => {
			const button = options.createEl('button', {
				cls: 'bpc-date-format-option',
				attr: { type: 'button', role: 'radio' },
			});
			button.dataset.value = choice.value;
			button.setAttribute('aria-checked', String(choice.value === selectedValue));
			const copy = button.createSpan('bpc-date-format-option__copy');
			copy.createEl('strong', { text: choice.label });
			copy.createSpan({ text: choice.detail });
			const check = button.createSpan('bpc-date-format-option__check');
			setIcon(check, 'check');
			button.addEventListener('click', () => {
				for (const candidate of buttons) {
					candidate.setAttribute('aria-checked', String(candidate === button));
				}
				const custom = choice.value === 'custom';
				customRow.hidden = !custom;
				if (custom) {
					if (!current || presetFormats.has(current)) commit(customInput.value);
					customInput.focus();
					customInput.select();
				} else commit(choice.value);
			});
			return button;
		});
		bindRadioGroup(options, buttons);

		const refreshCustom = (): boolean => {
			const format = customInput.value.trim();
			if (!isValidDateFormat(format)) {
				customInput.setAttribute('aria-invalid', 'true');
				customPreview.textContent = '';
				customError.textContent = 'Include at least one day, month, or year token.';
				return false;
			}
			customInput.removeAttribute('aria-invalid');
			customError.textContent = '';
			customPreview.textContent = `Preview · ${dateFormatPreview(format)}`;
			return true;
		};
		customInput.addEventListener('input', () => {
			if (refreshCustom()) commit(customInput.value.trim());
		});
		customInput.addEventListener('keydown', (event) => event.stopPropagation());
		customRow.hidden = selectedValue !== 'custom';
		refreshCustom();

		const help = panel.createDiv('bpc-date-format__help');
		help.createEl('strong', { text: 'Pattern tokens' });
		help.createSpan({ text: 'DD day · MMM short month · MMMM full month · YY or YYYY year' });

		const dismiss = (event: PointerEvent): void => {
			if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) this.close();
		};
		const changeNativeMenuItem = (event: PointerEvent): void => {
			const item = (event.target as Element | null)?.closest?.('.menu-item');
			if (item && item !== anchor && !panel.contains(item)) this.close();
		};
		const keydown = (event: KeyboardEvent): void => {
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
		queueMicrotask(() => buttons.find((button) =>
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
	const width = Math.min(300, viewportWidth - 24);
	panel.style.width = `${width}px`;
	const panelHeight = Math.min(panel.offsetHeight || 520, viewportHeight - 24);
	const right = Math.max(12, rect.right + 6);
	const left = right + width <= viewportWidth - 12
		? right
		: Math.max(12, rect.left - width - 6);
	panel.style.left = `${left}px`;
	panel.style.top = `${Math.max(12, Math.min(rect.top, viewportHeight - panelHeight - 12))}px`;
}

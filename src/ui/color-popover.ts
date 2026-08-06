import { normalizeHex, resolvePreset } from '../core/colors';
import { SettingsStore } from '../core/settings-store';
import { OptionIdentity, PRESET_NAMES, PresetName } from '../core/types';

export class ColorPopover {
	private panel: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;

	constructor(private readonly store: SettingsStore) {}

	openAtPoint(
		doc: Document,
		point: { x: number; y: number },
		identity: OptionIdentity,
	): void {
		this.open(doc, point, identity);
	}

	openAtElement(anchor: HTMLElement, identity: OptionIdentity): void {
		const rect = anchor.getBoundingClientRect();
		this.open(
			anchor.ownerDocument,
			{ x: rect.left, y: rect.bottom + 6 },
			identity,
		);
	}

	close(): void {
		this.cleanup?.();
		this.cleanup = null;
		this.panel = null;
	}

	private open(
		doc: Document,
		point: { x: number; y: number },
		identity: OptionIdentity,
	): void {
		this.close();
		const option = this.store.ensure(identity);
		const panel = doc.body.createDiv('bpc-popover');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', `Color for ${identity.value}`);
		panel.tabIndex = -1;

		const header = panel.createDiv('bpc-popover__header');
		const title = header.createEl('strong', { cls: 'bpc-popover__title' });
		title.textContent = identity.value;
		title.title = identity.value;
		const property = header.createSpan('bpc-popover__property');
		property.textContent = displayPropertyName(identity.propertyId);

		const label = panel.createDiv('bpc-popover__label');
		label.textContent = 'Color';

		const grid = panel.createDiv('bpc-swatch-grid');
		grid.setAttribute('role', 'group');
		grid.setAttribute('aria-label', 'Preset colors');

		const swatches = PRESET_NAMES.map((name) =>
			this.createSwatch(grid, name, identity),
		);
		const selectedPreset =
			option.override?.kind === 'preset' ? option.override.name : null;
		for (const swatch of swatches) {
			const name = swatch.dataset.preset as PresetName;
			swatch.setAttribute(
				'aria-pressed',
				String(name === selectedPreset),
			);
		}

		const customSection = panel.createDiv('bpc-custom-color');
		const customLabel = customSection.createEl('label', {
			cls: 'bpc-custom-color__label',
		});
		customLabel.textContent = 'Custom';
		const inputs = customSection.createDiv('bpc-custom-color__inputs');

		const initialHex =
			option.override?.kind === 'custom' ? option.override.hex : '#5B8def';
		const colorInput = inputs.createEl('input', {
			cls: 'bpc-custom-color__picker',
		});
		colorInput.type = 'color';
		colorInput.value = initialHex;
		colorInput.setAttribute('aria-label', 'Choose a custom color');

		const textInput = inputs.createEl('input', {
			cls: 'bpc-custom-color__text',
		});
		textInput.type = 'text';
		textInput.inputMode = 'text';
		textInput.value = initialHex;
		textInput.placeholder = '#5B8def';
		textInput.setAttribute('aria-label', 'Custom hex color');
		textInput.spellcheck = false;

		const error = customSection.createDiv('bpc-custom-color__error');
		error.setAttribute('aria-live', 'polite');

		const applyCustom = (input: string) => {
			const hex = normalizeHex(input);
			if (!hex) {
				textInput.setAttribute('aria-invalid', 'true');
				error.textContent = 'Use a 3 or 6 digit hex color.';
				return;
			}
			textInput.removeAttribute('aria-invalid');
			error.textContent = '';
			textInput.value = hex;
			colorInput.value = hex;
			this.store.setOverride(identity, { kind: 'custom', hex });
		};
		colorInput.addEventListener('input', () => applyCustom(colorInput.value));
		textInput.addEventListener('change', () => applyCustom(textInput.value));
		textInput.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') applyCustom(textInput.value);
		});

		const actions = panel.createDiv('bpc-popover__actions');
		const autoButton = actions.createEl('button', {
			cls: 'bpc-action-button',
		});
		autoButton.type = 'button';
		autoButton.textContent = 'Use automatic';
		autoButton.addEventListener('click', () => {
			this.store.setOverride(identity);
			this.close();
		});

		const offButton = actions.createEl('button', {
			cls: 'bpc-action-button bpc-action-button--muted',
		});
		offButton.type = 'button';
		offButton.textContent = 'Turn off';
		offButton.addEventListener('click', () => {
			this.store.setOverride(identity, { kind: 'disabled' });
			this.close();
		});

		this.panel = panel;
		positionPanel(panel, point);

		const outsideHandler = (event: PointerEvent) => {
			if (!panel.contains(event.target as Node)) this.close();
		};
		const keyHandler = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.close();
				return;
			}
			if (!swatches.includes(event.target as HTMLButtonElement)) return;
			const currentIndex = swatches.indexOf(event.target as HTMLButtonElement);
			let nextIndex = currentIndex;
			if (event.key === 'ArrowRight') nextIndex = currentIndex + 1;
			else if (event.key === 'ArrowLeft') nextIndex = currentIndex - 1;
			else if (event.key === 'ArrowDown') nextIndex = currentIndex + 5;
			else if (event.key === 'ArrowUp') nextIndex = currentIndex - 5;
			else return;
			event.preventDefault();
			swatches[(nextIndex + swatches.length) % swatches.length]?.focus();
		};

		doc.addEventListener('pointerdown', outsideHandler, true);
		panel.addEventListener('keydown', keyHandler);
		this.cleanup = () => {
			doc.removeEventListener('pointerdown', outsideHandler, true);
			panel.removeEventListener('keydown', keyHandler);
			panel.remove();
		};

		const preferred =
			swatches.find((swatch) => swatch.dataset.preset === selectedPreset) ??
			swatches[0];
		preferred?.focus();
	}

	private createSwatch(
		grid: HTMLElement,
		name: PresetName,
		identity: OptionIdentity,
	): HTMLButtonElement {
		const resolved = resolvePreset(name);
		const button = grid.createEl('button', { cls: 'bpc-swatch' });
		button.type = 'button';
		button.dataset.preset = name;
		button.title = resolved.label;
		button.setAttribute('aria-label', resolved.label);
		button.style.setProperty('--bpc-swatch', resolved.dot);
		button.addEventListener('click', () => {
			this.store.setOverride(identity, { kind: 'preset', name });
			this.close();
		});
		return button;
	}
}

export function displayPropertyName(propertyId: string): string {
	const separator = propertyId.indexOf('.');
	return separator >= 0 ? propertyId.slice(separator + 1) : propertyId;
}

function positionPanel(
	panel: HTMLElement,
	point: { x: number; y: number },
): void {
	const win = panel.ownerDocument.defaultView;
	if (!win) return;
	const margin = 12;
	const rect = panel.getBoundingClientRect();
	const left = Math.max(
		margin,
		Math.min(point.x, win.innerWidth - rect.width - margin),
	);
	const top = Math.max(
		margin,
		Math.min(point.y, win.innerHeight - rect.height - margin),
	);
	panel.style.left = `${left}px`;
	panel.style.top = `${top}px`;
}

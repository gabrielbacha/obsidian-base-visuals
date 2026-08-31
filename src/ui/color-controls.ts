import { normalizeHex, palettePresetName, paletteTemplate, resolvePreset } from '../core/colors';
import { SettingsStore } from '../core/settings-store';
import { OptionIdentity, PresetName } from '../core/types';

export interface ColorControlsHandle {
	focus(): void;
	refresh(): void;
	destroy(): void;
}

export function renderColorControls(
	container: HTMLElement,
	store: SettingsStore,
	identity: OptionIdentity,
	onClose?: () => void,
): ColorControlsHandle {
	const option = store.ensure(identity);
	const label = container.createDiv('bpc-popover__label');
	label.textContent = 'Color';

	const grid = container.createDiv('bpc-swatch-grid');
	grid.setAttribute('role', 'group');
	grid.setAttribute('aria-label', `Preset colors for ${identity.value}`);
	const paletteId = store.getPaletteTemplateId();
	const swatches = paletteTemplate(paletteId).colors
		.map((_entry, index) => createSwatch(grid, palettePresetName(paletteId, index), paletteId));

	const customSection = container.createDiv('bpc-custom-color');
	const customLabel = customSection.createEl('label', { cls: 'bpc-custom-color__label' });
	customLabel.textContent = 'Custom';
	const inputs = customSection.createDiv('bpc-custom-color__inputs');
	const initialHex = option.override?.kind === 'custom' ? option.override.hex : '#3498DB';
	const colorInput = inputs.createEl('input', { cls: 'bpc-custom-color__picker' });
	colorInput.type = 'color';
	colorInput.value = initialHex;
	colorInput.setAttribute('aria-label', 'Choose a custom color');
	const textInput = inputs.createEl('input', { cls: 'bpc-custom-color__text' });
	textInput.type = 'text';
	textInput.value = initialHex;
	textInput.placeholder = 'Hex color';
	textInput.setAttribute('aria-label', 'Custom hex color');
	textInput.setAttribute('autocomplete', 'off');
	textInput.name = 'bpc-custom-color';
	textInput.spellcheck = false;
	const error = customSection.createDiv('bpc-custom-color__error');
	error.setAttribute('aria-live', 'polite');

	const syncSelection = () => {
		const current = store.get(identity)?.override;
		for (const swatch of swatches) {
			const selected = current?.kind === 'preset' && current.name === swatch.dataset.preset;
			swatch.setAttribute('aria-pressed', String(selected));
		}
	};
	for (const swatch of swatches) {
		swatch.addEventListener('click', () => {
			store.setOverride(identity, { kind: 'preset', name: swatch.dataset.preset as PresetName });
			syncSelection();
			void store.flush();
			onClose?.();
		});
	}

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
		store.setOverride(identity, { kind: 'custom', hex });
		syncSelection();
	};
	colorInput.addEventListener('input', () => applyCustom(colorInput.value));
	colorInput.addEventListener('change', () => void store.flush());
	textInput.addEventListener('change', () => {
		applyCustom(textInput.value);
		void store.flush();
	});
	textInput.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			applyCustom(textInput.value);
			void store.flush();
		}
	});

	const actions = container.createDiv('bpc-popover__actions');
	const autoButton = actions.createEl('button', { text: 'Use strategy', cls: 'clickable-icon bpc-action-button' });
	autoButton.type = 'button';
	autoButton.addEventListener('click', () => {
		store.setOverride(identity);
		syncSelection();
		void store.flush();
		onClose?.();
	});
	const offButton = actions.createEl('button', {
		text: 'No color',
		cls: 'clickable-icon bpc-action-button bpc-action-button--muted',
	});
	offButton.type = 'button';
	offButton.addEventListener('click', () => {
		store.setOverride(identity, { kind: 'disabled' });
		syncSelection();
		void store.flush();
		onClose?.();
	});

	const keyHandler = (event: KeyboardEvent) => {
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
	container.addEventListener('keydown', keyHandler);
	syncSelection();

	return {
		focus: () => {
			const selected = swatches.find((swatch) => swatch.getAttribute('aria-pressed') === 'true');
			(selected ?? swatches[0])?.focus();
		},
		refresh: syncSelection,
		destroy: () => container.removeEventListener('keydown', keyHandler),
	};
}

function createSwatch(grid: HTMLElement, name: PresetName, paletteId: import('../core/types').PaletteTemplateId): HTMLButtonElement {
	const resolved = resolvePreset(name, paletteId);
	const button = grid.createEl('button', { cls: 'clickable-icon bpc-swatch' });
	button.type = 'button';
	button.dataset.preset = name;
	button.title = `${resolved.label} · ${resolved.dot}`;
	button.setAttribute('aria-label', resolved.label);
	button.style.setProperty('--bpc-swatch', resolved.dot);
	return button;
}

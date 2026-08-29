import { resolvePreset } from '../core/colors';
import { strategyLabel } from '../core/property-strategies';
import { SettingsStore } from '../core/settings-store';
import { PALETTE_NAMES, type PropertyStrategyMode } from '../core/types';
import type { PillStyle } from '../core/types';

const STRATEGIES: Array<{ value: PropertyStrategyMode; label: string }> = [
	{ value: 'smart', label: 'Smart' }, { value: 'distinct', label: 'Distinct values' },
	{ value: 'status', label: 'Status' }, { value: 'priority', label: 'Priority' },
	{ value: 'single', label: 'Single color' }, { value: 'neutral', label: 'Neutral' },
	{ value: 'off', label: 'Off' },
];

export function renderPropertyStrategyControls(
	container: HTMLElement,
	store: SettingsStore,
	propertyId: string,
	displayName: string,
	onChange?: () => void,
): void {
	const wrapper = container.createDiv('bpc-property-strategy');
	const row = wrapper.createDiv('bpc-property-strategy__row');
	const text = row.createDiv('bpc-property-strategy__text');
	text.createEl('strong', { text: 'Color strategy' });
	const inferred = store.getInferredPropertyStrategy(propertyId, displayName);
	const explicit = store.getExplicitPropertyStrategy(propertyId);
	text.createSpan({
		text: explicit ? strategyLabel(explicit) : `Smart · ${strategyLabel(inferred)}`,
		cls: 'setting-item-description',
	});
	const select = row.createEl('select', {
		cls: 'dropdown',
		attr: { 'aria-label': `Color strategy for ${displayName}` },
	});
	for (const option of STRATEGIES) {
		const element = select.createEl('option', { text: option.label });
		element.value = option.value;
	}
	select.value = explicit?.mode ?? 'smart';
	select.addEventListener('change', () => {
		const mode = select.value as PropertyStrategyMode;
		store.setPropertyStrategy(propertyId, mode === 'smart' ? undefined : {
			mode,
			...(mode === 'single' ? { preset: explicit?.preset ?? 'peter-river' } : {}),
		});
		onChange?.();
	});

	const styleRow = wrapper.createDiv('bpc-property-strategy__row bpc-property-strategy__style-row');
	const styleText = styleRow.createDiv('bpc-property-strategy__text');
	styleText.createEl('strong', { text: 'Pill style' });
	styleText.createSpan({
		text: ({ soft: 'Soft background', solid: 'Saturated background', outline: 'Colored border' })[store.getPropertyStyle(propertyId)],
		cls: 'setting-item-description',
	});
	const styleSelect = styleRow.createEl('select', {
		cls: 'dropdown',
		attr: { 'aria-label': `Pill style for ${displayName}` },
	});
	const styles: Array<{ value: PillStyle; label: string }> = [
		{ value: 'soft', label: 'Soft' },
		{ value: 'solid', label: 'Solid' },
		{ value: 'outline', label: 'Outline' },
	];
	for (const option of styles) {
		const element = styleSelect.createEl('option', { text: option.label });
		element.value = option.value;
	}
	styleSelect.value = store.getPropertyStyle(propertyId);
	styleSelect.addEventListener('change', () => {
		store.setPropertyStyle(propertyId, styleSelect.value as PillStyle);
		onChange?.();
	});

	const effective = store.getPropertyStrategy(propertyId, displayName);
	if (effective.mode !== 'single') return;
	const palette = wrapper.createDiv('bpc-property-strategy__palette');
	palette.setAttribute('role', 'group');
	palette.setAttribute('aria-label', `Single color for ${displayName}`);
	for (const name of PALETTE_NAMES) {
		const color = resolvePreset(name);
		const button = palette.createEl('button', {
			cls: 'bpc-property-strategy__swatch',
			attr: { type: 'button', 'aria-label': color.label, 'aria-pressed': String(effective.preset === name) },
		});
		button.style.setProperty('--bpc-swatch', color.dot);
		button.addEventListener('click', () => {
			store.setPropertyStrategy(propertyId, { mode: 'single', preset: name });
			onChange?.();
		});
	}
}

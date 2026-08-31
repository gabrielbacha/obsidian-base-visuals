import { setIcon } from 'obsidian';
import { palettePresetName, paletteTemplate, resolvePreset } from '../core/colors';
import { strategyLabel } from '../core/property-strategies';
import { SettingsStore } from '../core/settings-store';
import { type PropertyStrategyMode } from '../core/types';
import type { PillStyle } from '../core/types';

export const PILL_STYLES: Array<{
	value: PillStyle;
	label: string;
	detail: string;
}> = [
	{ value: 'soft', label: 'Soft', detail: 'Soft background' },
	{ value: 'solid', label: 'Solid', detail: 'Saturated background' },
	{ value: 'outline', label: 'Outline', detail: 'Colored border' },
];

export const STRATEGIES: Array<{
	value: PropertyStrategyMode;
	label: string;
	detail: string;
}> = [
	{ value: 'smart', label: 'Smart', detail: 'Infer from property name' },
	{ value: 'distinct', label: 'Distinct values', detail: 'Assign unique colors per value' },
	{ value: 'single', label: 'Single color', detail: 'Same color for all values' },
	{ value: 'neutral', label: 'Neutral', detail: 'Subtle gray for all values' },
	{ value: 'off', label: 'Off', detail: 'Disable pill colors' },
];

export function renderPropertyStrategyControls(
	container: HTMLElement,
	store: SettingsStore,
	propertyId: string,
	displayName: string,
	onChange?: () => void,
): void {
	const wrapper = container.createDiv('bpc-property-strategy');
	const currentStyle = store.getPropertyStyle(propertyId);
	const inferred = store.getInferredPropertyStrategy(propertyId, displayName);
	const explicit = store.getExplicitPropertyStrategy(propertyId);
	const currentMode = explicit?.mode ?? 'smart';
	const paletteId = store.getPaletteTemplateId();
	const effective = store.getPropertyStrategy(propertyId, displayName);
	const singlePresetColor = effective.mode === 'single' && effective.preset
		? resolvePreset(effective.preset, paletteId).dot
		: resolvePreset(explicit?.preset ?? 'peter-river', paletteId).dot;

	// Row 1: Pill style
	const styleRow = wrapper.createDiv('bpc-property-strategy__row');
	const styleText = styleRow.createDiv('bpc-property-strategy__text');
	styleText.createEl('strong', { text: 'Pill style' });
	const styleSubtext = styleText.createSpan({
		text: ({ soft: 'Soft background', solid: 'Saturated background', outline: 'Colored border' })[currentStyle],
		cls: 'setting-item-description',
	});

	renderDropdown({
		container: styleRow,
		ariaLabel: `Pill style for ${displayName}`,
		currentValue: currentStyle,
		items: PILL_STYLES,
		renderSample: (sample, value) => {
			sample.classList.add('bpc-pill-style-option__sample');
			const mini = sample.createSpan(`bpc-pill-preview-mini mod-${value}`);
			mini.textContent = 'Pill';
		},
		onSelect: (value) => {
			store.setPropertyStyle(propertyId, value);
			styleSubtext.textContent = ({ soft: 'Soft background', solid: 'Saturated background', outline: 'Colored border' })[value];
			commitExplicitChange(store, onChange);
		},
	});

	// Row 2: Color strategy
	const strategyRow = wrapper.createDiv('bpc-property-strategy__row');
	const strategyText = strategyRow.createDiv('bpc-property-strategy__text');
	strategyText.createEl('strong', { text: 'Color strategy' });
	const strategySubtextEl = strategyText.createSpan({
		text: currentMode === 'smart'
			? `Smart · ${strategyLabel(inferred)}`
			: (STRATEGIES.find((s) => s.value === currentMode)?.label ?? 'Smart'),
		cls: 'setting-item-description',
	});

	const strategyItems = STRATEGIES.map((s) => ({
		...s,
		detail: s.value === 'smart'
			? `Auto · ${strategyLabel(inferred)}`
			: s.detail,
	}));

	renderDropdown({
		container: strategyRow,
		ariaLabel: `Color strategy for ${displayName}`,
		currentValue: currentMode,
		items: strategyItems,
		renderSample: (sample, value) => {
			sample.classList.add('bpc-strategy-option__sample');
			renderStrategySample(sample, value, singlePresetColor);
		},
		onSelect: (value) => {
			const nextExplicit = value === 'smart' ? undefined : {
				mode: value,
				...(value === 'single' ? { preset: store.getExplicitPropertyStrategy(propertyId)?.preset ?? 'peter-river' } : {}),
			};
			store.setPropertyStrategy(propertyId, nextExplicit);
			strategySubtextEl.textContent = value === 'smart'
				? `Smart · ${strategyLabel(inferred)}`
				: (STRATEGIES.find((s) => s.value === value)?.label ?? 'Smart');
			paletteContainer.hidden = value !== 'single';
			commitExplicitChange(store, onChange);
		},
	});

	// Swatches for single color
	const paletteContainer = wrapper.createDiv('bpc-property-strategy__palette-container');
	paletteContainer.hidden = currentMode !== 'single';
	const palette = paletteContainer.createDiv('bpc-property-strategy__palette');
	palette.setAttribute('role', 'group');
	palette.setAttribute('aria-label', `Single color for ${displayName}`);
	const selectedColor = explicit?.mode === 'single' && explicit.preset
		? resolvePreset(explicit.preset, paletteId).dot
		: resolvePreset('peter-river', paletteId).dot;
	for (const [index, entry] of paletteTemplate(paletteId).colors.entries()) {
		const presetName = palettePresetName(paletteId, index);
		const color = resolvePreset(presetName, paletteId);
		const swatch = palette.createEl('button', {
			cls: 'bpc-property-strategy__swatch',
			attr: { type: 'button', 'aria-label': color.label, 'aria-pressed': String(selectedColor === color.dot) },
		});
		swatch.title = `${color.label} · ${entry.hex}`;
		swatch.style.setProperty('--bpc-swatch', color.dot);
		swatch.addEventListener('click', () => {
			store.setPropertyStrategy(propertyId, { mode: 'single', preset: presetName });
			for (const s of palette.querySelectorAll<HTMLButtonElement>('.bpc-property-strategy__swatch')) {
				s.setAttribute('aria-pressed', String(s === swatch));
			}
			commitExplicitChange(store, onChange);
		});
	}
}

interface DropdownItem<T> {
	value: T;
	label: string;
	detail: string;
}

function renderDropdown<T extends string>(options: {
	container: HTMLElement;
	ariaLabel: string;
	currentValue: T;
	items: Array<DropdownItem<T>>;
	renderSample: (sampleEl: HTMLElement, value: T) => void;
	onSelect: (value: T) => void;
}): void {
	const picker = options.container.createDiv('bpc-custom-dropdown');
	let activeValue = options.currentValue;
	const selectedItem = options.items.find((item) => item.value === activeValue) ?? options.items[0];

	const trigger = picker.createEl('button', {
		cls: 'bpc-custom-dropdown__trigger',
		attr: {
			type: 'button',
			'aria-haspopup': 'listbox',
			'aria-expanded': 'false',
			'aria-label': options.ariaLabel,
		},
	});

	const triggerSample = trigger.createSpan('bpc-custom-dropdown__trigger-sample');
	if (selectedItem) {
		options.renderSample(triggerSample, selectedItem.value);
	}

	const triggerText = trigger.createSpan('bpc-custom-dropdown__trigger-text');
	const triggerTitle = triggerText.createEl('strong', { text: selectedItem?.label ?? '' });

	const chevron = trigger.createSpan('bpc-custom-dropdown__chevron');
	setIcon(chevron, 'chevron-down');

	const doc = picker.ownerDocument;
	const menu = doc.body.createDiv('bpc-custom-dropdown__menu');
	menu.hidden = true;
	menu.setAttribute('role', 'listbox');
	menu.setAttribute('aria-label', options.ariaLabel);
	menu.remove();

	const optionEntries: Array<{
		button: HTMLButtonElement;
		item: DropdownItem<T>;
		check: HTMLSpanElement;
	}> = [];

	for (const item of options.items) {
		const isSelected = item.value === activeValue;
		const button = menu.createEl('button', {
			cls: `bpc-custom-dropdown__option mod-${item.value}${isSelected ? ' is-selected' : ''}`,
			attr: {
				type: 'button',
				role: 'option',
				'aria-selected': String(isSelected),
				'data-value': item.value,
			},
		});

		const sample = button.createSpan('bpc-custom-dropdown__option-sample');
		options.renderSample(sample, item.value);

		const copy = button.createSpan('bpc-custom-dropdown__option-copy');
		copy.createEl('strong', { text: item.label });
		copy.createSpan({ text: item.detail });

		const check = button.createSpan('bpc-custom-dropdown__option-check');
		if (isSelected) setIcon(check, 'check');

		button.addEventListener('pointerdown', (event) => {
			// The listbox lives at document level. Keep Obsidian's native menu
			// dismissal handlers from consuming the activation before click.
			event.stopPropagation();
		});
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			activeValue = item.value;
			updateVisualSelection(item.value);
			closeDropdown();
			options.onSelect(item.value);
		});

		optionEntries.push({ button, item, check });
	}

	const updateVisualSelection = (newValue: T) => {
		const newSelectedItem = options.items.find((item) => item.value === newValue);
		if (newSelectedItem) {
			triggerSample.empty();
			options.renderSample(triggerSample, newSelectedItem.value);
			triggerTitle.textContent = newSelectedItem.label;
		}

		for (const entry of optionEntries) {
			const isSel = entry.item.value === newValue;
			entry.button.setAttribute('aria-selected', String(isSel));
			if (isSel) {
				entry.button.classList.add('is-selected');
				entry.check.empty();
				setIcon(entry.check, 'check');
			} else {
				entry.button.classList.remove('is-selected');
				entry.check.empty();
			}
		}
	};

	const closeDropdown = (restoreFocus = false) => {
		if (menu.hidden) return;
		menu.hidden = true;
		menu.remove();
		picker.classList.remove('is-open');
		trigger.setAttribute('aria-expanded', 'false');
		doc.removeEventListener('pointerdown', onPointerDown, true);
		doc.removeEventListener('keydown', onKeyDown);
		if (restoreFocus) trigger.focus();
	};

	const onPointerDown = (event: PointerEvent) => {
		if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) {
			closeDropdown();
		}
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			closeDropdown(true);
		}
	};

	const openDropdown = (focusSelection = false) => {
		for (const other of doc.querySelectorAll<HTMLElement>('.bpc-custom-dropdown.is-open')) {
			if (other !== picker) {
				other.classList.remove('is-open');
				const otherTrigger = other.querySelector<HTMLButtonElement>('.bpc-custom-dropdown__trigger');
				otherTrigger?.setAttribute('aria-expanded', 'false');
			}
		}
		for (const openMenu of doc.querySelectorAll<HTMLElement>('.bpc-custom-dropdown__menu')) {
			openMenu.remove();
		}

		menu.hidden = false;
		picker.classList.add('is-open');
		trigger.setAttribute('aria-expanded', 'true');
		positionDropdownMenu(menu, trigger, doc);
		doc.addEventListener('pointerdown', onPointerDown, true);
		doc.addEventListener('keydown', onKeyDown);

		if (focusSelection) {
			const activeBtn = optionEntries.find((e) => e.item.value === activeValue)?.button;
			(activeBtn ?? optionEntries[0]?.button)?.focus();
		}
	};

	trigger.addEventListener('click', () => menu.hidden ? openDropdown() : closeDropdown());
	trigger.addEventListener('keydown', (event) => {
		if (event.key !== 'ArrowDown') return;
		event.preventDefault();
		openDropdown(true);
	});

	menu.addEventListener('keydown', (event) => {
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			closeDropdown(true);
			return;
		}
		const buttons = optionEntries.map((e) => e.button);
		const current = buttons.indexOf(event.target as HTMLButtonElement);
		let next = current;
		if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 1);
		if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
		if (event.key === 'Home') next = 0;
		if (event.key === 'End') next = buttons.length - 1;
		event.preventDefault();
		buttons[next]?.focus();
	});
}

function commitExplicitChange(store: SettingsStore, onChange?: () => void): void {
	// Discovery writes remain debounced, but a deliberate UI choice must become
	// authoritative before Obsidian can rerender the native Base view.
	onChange?.();
	void store.flush();
}

function positionDropdownMenu(menu: HTMLElement, trigger: HTMLElement, doc: Document): void {
	const win = doc.defaultView ?? window;
	const viewportWidth = win.innerWidth || 800;
	const viewportHeight = win.innerHeight || 600;
	const rect = trigger.getBoundingClientRect();
	const menuWidth = Math.min(270, viewportWidth - 24);

	menu.style.width = `${menuWidth}px`;
	doc.body.appendChild(menu);
	const menuHeight = menu.offsetHeight || 220;

	const spaceBelow = viewportHeight - rect.bottom - 8;
	const spaceAbove = rect.top - 8;

	let top: number;
	let maxHeight: number;

	if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
		maxHeight = Math.min(360, spaceAbove);
		top = Math.max(8, rect.top - Math.min(menuHeight, maxHeight) - 4);
	} else {
		maxHeight = Math.min(360, spaceBelow);
		top = rect.bottom + 4;
	}

	const left = Math.max(8, Math.min(rect.right - menuWidth, viewportWidth - menuWidth - 8));

	menu.style.top = `${top}px`;
	menu.style.left = `${left}px`;
	menu.style.maxHeight = `${maxHeight}px`;
}

function renderStrategySample(sample: HTMLElement, mode: PropertyStrategyMode, singleColor: string): void {
	if (mode === 'smart') {
		const dots = sample.createSpan('bpc-strategy-sample-dots');
		dots.createSpan('bpc-strategy-dot mod-blue');
		dots.createSpan('bpc-strategy-dot mod-green');
		dots.createSpan('bpc-strategy-dot mod-orange');
		dots.createSpan('bpc-strategy-dot mod-purple');
	} else if (mode === 'distinct') {
		const dots = sample.createSpan('bpc-strategy-sample-dots');
		dots.createSpan('bpc-strategy-dot mod-purple');
		dots.createSpan('bpc-strategy-dot mod-teal');
		dots.createSpan('bpc-strategy-dot mod-orange');
		dots.createSpan('bpc-strategy-dot mod-pink');
	} else if (mode === 'single') {
		const dot = sample.createSpan('bpc-strategy-dot mod-single');
		dot.style.setProperty('--bpc-swatch', singleColor);
	} else if (mode === 'neutral') {
		sample.createSpan('bpc-strategy-dot mod-neutral');
	} else if (mode === 'off') {
		sample.createSpan({ cls: 'bpc-strategy-sample-off', text: '—' });
	}
}

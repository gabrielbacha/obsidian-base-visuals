import { App, Modal, Notice, setIcon } from 'obsidian';
import { resolveColor } from '../core/colors';
import { SettingsStore } from '../core/settings-store';
import { PALETTE_TEMPLATE_IDS, StoredOption } from '../core/types';
import { PALETTE_TEMPLATES } from '../core/colors';
import { ColorPopover, displayPropertyName } from './color-popover';
import { renderPropertyStrategyControls } from './property-strategy-controls';
import { compareNaturalValues } from '../core/value-order';
import type { UnusedOptionsPlan } from '../core/unused-options';

export class PillColorManagerView {
	private container: HTMLElement | null = null;
	private unsubscribe: (() => void) | null = null;
	private palettePickerCleanup: (() => void) | null = null;

	constructor(
		private readonly app: App,
		private readonly store: SettingsStore,
		private readonly popover: ColorPopover,
		private readonly reactive = true,
		private readonly propertyNameFor: (propertyId: string) => string = displayPropertyName,
		private readonly unusedOptionsPlan?: () => UnusedOptionsPlan,
		private readonly allowedPropertyIds?: ReadonlySet<string>,
	) {}

	mount(container: HTMLElement): void {
		this.container = container;
		if (this.reactive) {
			this.unsubscribe = this.store.subscribe(() => {
				const doc = this.container?.ownerDocument ?? document;
				if (doc.querySelector('.bpc-custom-dropdown.is-open')) {
					this.updateOptionPreviews();
				} else {
					this.render();
				}
			});
		}
		this.render();
	}

	private updateOptionPreviews(): void {
		if (!this.container) return;
		for (const section of this.container.querySelectorAll<HTMLElement>('.bpc-property-group')) {
			const heading = section.querySelector<HTMLElement>('.bpc-property-group__title');
			const propertyId = heading?.title;
			if (!propertyId) continue;
			for (const row of section.querySelectorAll<HTMLElement>('.bpc-option-row')) {
				const preview = row.querySelector<HTMLElement>('.bpc-settings-pill');
				const state = row.querySelector<HTMLElement>('.bpc-option-row__state');
				const val = preview?.title;
				if (!preview || !val) continue;
				const identity = { propertyId, value: val };
				const opt: StoredOption = this.store.get(identity) ?? identity;
				applyPreviewColor(preview, opt, this.store, this.propertyNameFor(propertyId));
				if (state) {
					state.textContent = resolveColor(
						opt,
						opt.override,
						this.store.getPropertyStrategy(propertyId, this.propertyNameFor(propertyId)),
						this.store.getPaletteTemplateId(),
					).label;
				}
			}
		}
	}

	unmount(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.palettePickerCleanup?.();
		this.palettePickerCleanup = null;
		this.popover.close();
		this.container = null;
	}

	private render(): void {
		if (!this.container) return;
		this.palettePickerCleanup?.();
		this.palettePickerCleanup = null;
		this.container.empty();
		this.container.addClass('bpc-pill-manager');
		this.container.createEl('p', {
			text: 'Manage list values discovered in this base. Colors are shared by every view in this base.',
			cls: 'setting-item-description bpc-pill-manager__intro',
		});

		const selectedTemplate = PALETTE_TEMPLATES.find((template) =>
			template.id === this.store.getPaletteTemplateId()) ?? PALETTE_TEMPLATES[0]!;
		const paletteBar = this.container.createDiv('bpc-palette-template');
		const paletteCopy = paletteBar.createDiv('bpc-palette-template__copy');
		paletteCopy.createEl('strong', { text: 'Color palette' });
		paletteCopy.createSpan({
			text: selectedTemplate.description,
			cls: 'setting-item-description',
		});
		const picker = paletteBar.createDiv('bpc-palette-picker');
		const trigger = picker.createEl('button', {
			cls: 'bpc-palette-picker__trigger',
			attr: { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' },
		});
		trigger.createSpan({ text: selectedTemplate.label, cls: 'bpc-palette-picker__trigger-label' });
		const chevron = trigger.createSpan('bpc-palette-picker__chevron');
		setIcon(chevron, 'chevron-down');
		renderPaletteStrip(trigger, selectedTemplate.colors.map((color) => color.hex), 'bpc-palette-strip--trigger');

		const menu = picker.createDiv('bpc-palette-picker__menu');
		menu.hidden = true;
		menu.setAttribute('role', 'listbox');
		menu.setAttribute('aria-label', 'Color palette templates');
		let selectedOption: HTMLButtonElement | null = null;
		for (const template of PALETTE_TEMPLATES) {
			const option = menu.createEl('button', {
				cls: 'bpc-palette-option',
				attr: {
					type: 'button', role: 'option',
					'aria-selected': String(template.id === selectedTemplate.id),
				},
			});
			if (template.id === selectedTemplate.id) {
				option.addClass('is-selected');
				selectedOption = option;
			}
			const optionHeader = option.createDiv('bpc-palette-option__header');
			const optionCopy = optionHeader.createDiv('bpc-palette-option__copy');
			optionCopy.createEl('strong', { text: template.label });
			optionCopy.createSpan({ text: template.description });
			const mark = optionHeader.createSpan('bpc-palette-option__check');
			if (template.id === selectedTemplate.id) setIcon(mark, 'check');
			renderPaletteStrip(option, template.colors.map((color) => color.hex), 'bpc-palette-strip--option');
			option.addEventListener('click', () => {
				if (PALETTE_TEMPLATE_IDS.includes(template.id)) this.store.setPaletteTemplateId(template.id);
			});
		}

		const closePicker = (restoreFocus = false) => {
			if (menu.hidden) return;
			menu.hidden = true;
			picker.removeClass('is-open');
			trigger.setAttribute('aria-expanded', 'false');
			if (restoreFocus) trigger.focus();
		};
		const openPicker = (focusSelection = false) => {
			menu.hidden = false;
			picker.addClass('is-open');
			trigger.setAttribute('aria-expanded', 'true');
			if (focusSelection) (selectedOption ?? menu.querySelector<HTMLButtonElement>('.bpc-palette-option'))?.focus();
		};
		trigger.addEventListener('click', () => menu.hidden ? openPicker() : closePicker());
		trigger.addEventListener('keydown', (event) => {
			if (event.key !== 'ArrowDown') return;
			event.preventDefault();
			openPicker(true);
		});
		menu.addEventListener('keydown', (event) => {
			if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
			const options = [...menu.querySelectorAll<HTMLButtonElement>('.bpc-palette-option')];
			const current = options.indexOf(event.target as HTMLButtonElement);
			let next = current;
			if (event.key === 'ArrowDown') next = Math.min(options.length - 1, current + 1);
			if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
			if (event.key === 'Home') next = 0;
			if (event.key === 'End') next = options.length - 1;
			event.preventDefault();
			options[next]?.focus();
		});
		const onDocumentPointerDown = (event: PointerEvent) => {
			if (!picker.contains(event.target as Node)) closePicker();
		};
		const onDocumentKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !menu.hidden) closePicker(true);
		};
		const doc = paletteBar.ownerDocument;
		doc.addEventListener('pointerdown', onDocumentPointerDown, true);
		doc.addEventListener('keydown', onDocumentKeyDown);
		this.palettePickerCleanup = () => {
			doc.removeEventListener('pointerdown', onDocumentPointerDown, true);
			doc.removeEventListener('keydown', onDocumentKeyDown);
		};

		const toolbar = this.container.createDiv('bpc-manager-toolbar');
		const search = toolbar.createEl('input', {
			type: 'search',
			placeholder: 'Search properties & values…',
			cls: 'bpc-manager-search',
			attr: { 'aria-label': 'Search properties and values', autocomplete: 'off', name: 'bpc-property-value-search' },
		});
		search.value = this.store.settings.managerSearch;

		if (this.unusedOptionsPlan) {
			const cleanup = toolbar.createEl('button', {
				text: 'Clean unused',
				cls: 'bpc-manager-cleanup',
				attr: { type: 'button' },
			});
			cleanup.addEventListener('click', () => {
				const plan = this.unusedOptionsPlan?.();
				if (!plan || plan.verifiedProperties === 0) {
					new Notice('No base values are currently available to verify.');
					return;
				}
				const strategyCount = plan.removedProperties.filter((propertyId) =>
					Boolean(this.store.getExplicitPropertyStrategy(propertyId))).length;
				const total = plan.options.length + strategyCount;
				if (total === 0) {
					new Notice('No unused pill color settings found.');
					return;
				}
				new ConfirmCleanupModal(this.app, plan.options.length, strategyCount, () => {
					const removed = this.store.removeUnusedOptions(plan.options, plan.removedProperties);
					new Notice(`Cleaned ${removed} unused visual ${removed === 1 ? 'setting' : 'settings'}.`);
				}).open();
			});
		}

		if (this.store.hasOverrides(this.allowedPropertyIds)) {
			const resetAll = toolbar.createEl('button', {
				text: 'Reset all overrides',
				cls: 'bpc-manager-reset',
				attr: { type: 'button' },
			});
			resetAll.addEventListener('click', () => {
				new ConfirmResetModal(
					this.app,
					'Reset all pill colors?',
					'Value overrides and explicit property strategies will be cleared. Smart strategies will be inferred again; your notes will not be changed.',
					() => this.store.resetProperties(this.allowedPropertyIds),
				).open();
			});
		}

		const results = this.container.createDiv('bpc-manager-results');
		const renderResults = () => {
			results.empty();
			this.renderGroups(results, search.value);
		};
		search.addEventListener('input', () => {
			this.store.setManagerSearch(search.value);
			renderResults();
		});
		renderResults();
	}

	private renderGroups(container: HTMLElement, query: string): void {
		const allOptions = this.store.allOptions().filter((option) =>
			this.allowedPropertyIds?.has(option.propertyId) ?? true);
		const normalizedQuery = query.trim().toLocaleLowerCase();
		const options = allOptions
			.filter((option) => !normalizedQuery ||
				`${this.propertyNameFor(option.propertyId)} ${option.value}`
					.toLocaleLowerCase()
					.includes(normalizedQuery))
			.sort(compareOptions);

		if (allOptions.length === 0) {
			const empty = container.createDiv('bpc-empty-state');
			empty.createEl('strong', { text: 'No list values discovered yet' });
			empty.createEl('p', {
				text: 'Open a base table containing a list property. Values appear here as soon as they are rendered.',
			});
			return;
		}
		if (options.length === 0) {
			const empty = container.createDiv('bpc-empty-state');
			empty.createEl('strong', { text: 'No matching values' });
			const clear = empty.createEl('button', { text: 'Clear search', attr: { type: 'button' } });
			clear.addEventListener('click', () => {
				this.store.setManagerSearch('');
				this.render();
			});
			return;
		}

		for (const [propertyId, propertyOptions] of groupOptions(options)) {
			this.renderGroup(container, propertyId, propertyOptions);
		}
	}

	private renderGroup(container: HTMLElement, propertyId: string, options: StoredOption[]): void {
		const section = container.createEl('section', { cls: 'bpc-property-group' });
		const header = section.createDiv('bpc-property-group__header');
		const titleGroup = header.createDiv('bpc-property-group__title-group');
		const heading = titleGroup.createSpan({
			text: this.propertyNameFor(propertyId),
			cls: 'bpc-property-group__title',
			attr: { role: 'heading', 'aria-level': '3' },
		});
		heading.title = propertyId;
		titleGroup.createSpan({
			text: String(options.length),
			cls: 'bpc-property-group__count',
			attr: { 'aria-label': `${options.length} values` },
		});

		const reset = header.createEl('button', {
			text: 'Reset property',
			cls: 'bpc-property-group__reset',
			attr: { type: 'button' },
		});
		reset.addEventListener('click', () => {
			new ConfirmResetModal(
				this.app,
				`Reset ${this.propertyNameFor(propertyId)} colors?`,
				'Value overrides will be cleared and this property will return to its Smart strategy.',
				() => this.store.resetProperty(propertyId),
			).open();
		});

		renderPropertyStrategyControls(section, this.store, propertyId, this.propertyNameFor(propertyId));

		const list = section.createDiv('bpc-option-list');
		for (const option of options) this.renderOption(list, option);
	}

	private renderOption(container: HTMLElement, option: StoredOption): void {
		const row = container.createDiv('bpc-option-row');
		const preview = row.createSpan({
			text: option.value,
			cls: 'bpc-pill bpc-pill--colored bpc-settings-pill',
		});
		preview.title = option.value;
		applyPreviewColor(preview, option, this.store, this.propertyNameFor(option.propertyId));

		row.createSpan({
			text: resolveColor(option, option.override, this.store.getPropertyStrategy(option.propertyId, this.propertyNameFor(option.propertyId)), this.store.getPaletteTemplateId()).label,
			cls: 'bpc-option-row__state',
		});

		const change = row.createEl('button', {
			text: 'Change color',
			cls: 'bpc-option-row__change',
			attr: { type: 'button' },
		});
		change.addEventListener('click', () => this.popover.openAtElement(change, option, this.store));
	}
}

export class ConfirmResetModal extends Modal {
	constructor(
		app: App,
		private readonly heading: string,
		private readonly message: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.addClass('bpc-confirm-modal');
		this.contentEl.createEl('p', { text: this.message });
		const actions = this.contentEl.createDiv('bpc-confirm-modal__actions');
		const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			text: 'Reset colors',
			cls: 'mod-warning',
			attr: { type: 'button' },
		});
		confirm.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});
		confirm.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class ConfirmCleanupModal extends Modal {
	constructor(
		app: App,
		private readonly valueCount: number,
		private readonly strategyCount: number,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Clean unused pill settings?');
		this.contentEl.addClass('bpc-confirm-modal');
		const total = this.valueCount + this.strategyCount;
		this.contentEl.createEl('p', {
			text: `${total} saved visual ${total === 1 ? 'setting is' : 'settings are'} no longer used. This removes only Bases Visuals configuration; notes and property values will not be changed.`,
		});
		const detail = this.contentEl.createEl('p', { cls: 'setting-item-description' });
		detail.textContent = 'Note properties are checked across the vault. Calculated properties are checked against the current base results.';
		const actions = this.contentEl.createDiv('bpc-confirm-modal__actions');
		const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', { text: 'Clean unused', cls: 'mod-warning', attr: { type: 'button' } });
		confirm.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});
		confirm.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function renderPaletteStrip(container: HTMLElement, colors: readonly string[], modifier: string): HTMLElement {
	const strip = container.createDiv(`bpc-palette-strip ${modifier}`);
	strip.setAttribute('aria-hidden', 'true');
	for (const color of colors) {
		const swatch = strip.createSpan('bpc-palette-strip__color');
		swatch.style.backgroundColor = color;
	}
	return strip;
}

export function applyPreviewColor(element: HTMLElement, option: StoredOption, store?: SettingsStore, propertyName?: string): void {
	const color = resolveColor(option, option.override, store?.getPropertyStrategy(option.propertyId, propertyName), store?.getPaletteTemplateId());
	const style = store?.getPropertyStyle(option.propertyId) ?? 'soft';
	if (color.kind === 'disabled') {
		element.classList.remove('bpc-pill--colored', 'bpc-pill--neutral');
		element.classList.remove('bpc-pill-style-soft', 'bpc-pill-style-solid', 'bpc-pill-style-outline');
		for (const variable of ['--bpc-bg', '--bpc-bg-hover', '--bpc-fg-light', '--bpc-fg-dark', '--bpc-border', '--bpc-accent', '--bpc-solid-bg', '--bpc-solid-fg', '--bpc-solid-bg-hover']) {
			element.style.removeProperty(variable);
		}
		return;
	}
	element.classList.add('bpc-pill--colored');
	element.classList.toggle('bpc-pill--neutral', color.kind === 'neutral');
	element.classList.remove('bpc-pill-style-soft', 'bpc-pill-style-solid', 'bpc-pill-style-outline');
	element.classList.add(`bpc-pill-style-${style}`);
	element.style.setProperty('--bpc-bg', color.background);
	element.style.setProperty('--bpc-bg-hover', color.hoverBackground);
	element.style.setProperty('--bpc-fg-light', color.foregroundLight);
	element.style.setProperty('--bpc-fg-dark', color.foregroundDark);
	element.style.setProperty('--bpc-border', color.border);
	element.style.setProperty('--bpc-accent', color.dot);
	element.style.setProperty('--bpc-solid-bg', color.solidBackground);
	element.style.setProperty('--bpc-solid-fg', color.solidForeground);
	element.style.setProperty('--bpc-solid-bg-hover', color.solidHoverBackground);
}

function compareOptions(first: StoredOption, second: StoredOption): number {
	return first.propertyId.localeCompare(second.propertyId) || compareNaturalValues(first.value, second.value);
}

function groupOptions(options: StoredOption[]): Map<string, StoredOption[]> {
	const groups = new Map<string, StoredOption[]>();
	for (const option of options) {
		const values = groups.get(option.propertyId) ?? [];
		values.push(option);
		groups.set(option.propertyId, values);
	}
	return groups;
}

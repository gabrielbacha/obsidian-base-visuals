import { App, Modal } from 'obsidian';
import { resolveColor } from '../core/colors';
import { SettingsStore } from '../core/settings-store';
import { StoredOption } from '../core/types';
import { ColorPopover, displayPropertyName } from './color-popover';

export class PillColorManagerView {
	private container: HTMLElement | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(
		private readonly app: App,
		private readonly store: SettingsStore,
		private readonly popover: ColorPopover,
		private readonly reactive = true,
	) {}

	mount(container: HTMLElement): void {
		this.container = container;
		if (this.reactive) this.unsubscribe = this.store.subscribe(() => this.render());
		this.render();
	}

	unmount(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.popover.close();
		this.container = null;
	}

	private render(): void {
		if (!this.container) return;
		this.container.empty();
		this.container.addClass('bpc-pill-manager');
		this.container.createEl('p', {
			text: 'Manage list values discovered in this base. Colors are shared by every view in this base.',
			cls: 'setting-item-description bpc-pill-manager__intro',
		});

		const toolbar = this.container.createDiv('bpc-manager-toolbar');
		const search = toolbar.createEl('input', {
			type: 'search',
			placeholder: 'Search properties & values…',
			cls: 'bpc-manager-search',
			attr: { 'aria-label': 'Search properties and values', autocomplete: 'off', name: 'bpc-property-value-search' },
		});
		search.value = this.store.settings.managerSearch;

		if (this.store.hasOverrides()) {
			const resetAll = toolbar.createEl('button', {
				text: 'Reset all overrides',
				cls: 'bpc-manager-reset',
				attr: { type: 'button' },
			});
			resetAll.addEventListener('click', () => {
				new ConfirmResetModal(
					this.app,
					'Reset all pill colors?',
					'Every value will return to its stable automatic color. Your note properties will not be changed.',
					() => this.store.resetAll(),
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
		const allOptions = this.store.allOptions();
		const normalizedQuery = query.trim().toLocaleLowerCase();
		const options = allOptions
			.filter((option) => !normalizedQuery ||
				`${displayPropertyName(option.propertyId)} ${option.value}`
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
			text: displayPropertyName(propertyId),
			cls: 'bpc-property-group__title',
			attr: { role: 'heading', 'aria-level': '3' },
		});
		heading.title = propertyId;
		titleGroup.createSpan({
			text: String(options.length),
			cls: 'bpc-property-group__count',
			attr: { 'aria-label': `${options.length} values` },
		});

		if (options.some((option) => option.override !== undefined)) {
			const reset = header.createEl('button', {
				text: 'Reset property',
				cls: 'bpc-property-group__reset',
				attr: { type: 'button' },
			});
			reset.addEventListener('click', () => {
				new ConfirmResetModal(
					this.app,
					`Reset ${displayPropertyName(propertyId)} colors?`,
					'All values in this property will return to their stable automatic colors.',
					() => this.store.resetProperty(propertyId),
				).open();
			});
		}

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
		applyPreviewColor(preview, option);

		row.createSpan({
			text: resolveColor(option, option.override).label,
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

export function applyPreviewColor(element: HTMLElement, option: StoredOption): void {
	const color = resolveColor(option, option.override);
	if (color.kind === 'disabled') {
		element.classList.remove('bpc-pill--colored');
		for (const variable of ['--bpc-bg', '--bpc-bg-hover', '--bpc-fg-light', '--bpc-fg-dark']) {
			element.style.removeProperty(variable);
		}
		return;
	}
	element.classList.add('bpc-pill--colored');
	element.style.setProperty('--bpc-bg', color.background);
	element.style.setProperty('--bpc-bg-hover', color.hoverBackground);
	element.style.setProperty('--bpc-fg-light', color.foregroundLight);
	element.style.setProperty('--bpc-fg-dark', color.foregroundDark);
}

function compareOptions(first: StoredOption, second: StoredOption): number {
	return first.propertyId.localeCompare(second.propertyId) || first.value.localeCompare(second.value);
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

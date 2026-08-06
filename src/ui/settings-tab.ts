import { App, Modal, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import { resolveColor } from '../core/colors';
import { SettingsStore } from '../core/settings-store';
import { StoredOption } from '../core/types';
import { ColorPopover, displayPropertyName } from './color-popover';
import { RuleManagerView } from './rule-manager';
import type BasesPillColorsPlugin from '../main';

export class BasesPillColorsSettingTab extends PluginSettingTab {
	private unsubscribe: (() => void) | null = null;
	private renderRoot: HTMLElement | null = null;
	private ruleManager: RuleManagerView | null = null;

	constructor(
		app: App,
		plugin: BasesPillColorsPlugin,
		private readonly store: SettingsStore,
		private readonly popover: ColorPopover,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Property color manager',
				desc: 'Search and edit discovered list values.',
				aliases: this.store
					.allOptions()
					.flatMap((option) => [option.propertyId, option.value]),
				render: (setting) => {
					setting.settingEl.empty();
					setting.settingEl.addClass('bpc-settings-host');
					this.mount(setting.settingEl);
					return () => {
						if (this.renderRoot === setting.settingEl) this.unmount();
					};
				},
			},
		];
	}

	// Compatibility fallback for Obsidian 1.9 through 1.12.
	display(): void {
		this.mount(this.containerEl);
	}

	private mount(containerEl: HTMLElement): void {
		this.unsubscribe?.();
		this.renderRoot = containerEl;
		this.unsubscribe = this.store.subscribe(() => {
			if (this.renderRoot) this.renderContent(this.renderRoot);
		});
		this.renderContent(containerEl);
	}

	private renderContent(containerEl: HTMLElement): void {
		this.ruleManager?.unmount();
		this.ruleManager = null;
		containerEl.empty();
		containerEl.addClass('bpc-settings');

		new Setting(containerEl).setName('Conditional formatting').setHeading();
		const ruleHost = containerEl.createDiv('bpc-settings-section');
		this.ruleManager = new RuleManagerView(this.app, this.store, [], false);
		this.ruleManager.mount(ruleHost);

		new Setting(containerEl).setName('Pill colors').setHeading().settingEl.addClass('bpc-settings-section-title');
		containerEl.createEl('p', {
			text: 'Notion-style colors for list values in base tables. Right-click any colored pill to change it.',
			cls: 'bpc-settings-intro setting-item-description',
		});

		const toolbar = containerEl.createDiv('bpc-manager-toolbar');
		const search = toolbar.createEl('input', {
			type: 'search',
			placeholder: 'Search properties and values',
			cls: 'bpc-manager-search',
			attr: { 'aria-label': 'Search properties and values' },
		});
		search.value = this.store.settings.managerSearch;

		if (this.store.hasOverrides()) {
			const resetAll = toolbar.createEl('button', {
				text: 'Reset all',
				cls: 'bpc-manager-reset',
				attr: { type: 'button' },
			});
			resetAll.addEventListener('click', () => {
				new ConfirmResetModal(
					this.app,
					'Reset all color overrides?',
					'Every value will return to its stable automatic color. Your note properties will not be changed.',
					() => this.store.resetAll(),
				).open();
			});
		}

		const results = containerEl.createDiv('bpc-manager-results');
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

	hide(): void {
		this.unmount();
		this.popover.close();
	}

	private unmount(): void {
		this.ruleManager?.unmount();
		this.ruleManager = null;
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.renderRoot = null;
	}

	private renderGroups(container: HTMLElement, query: string): void {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		const options = this.store
			.allOptions()
			.filter((option) => {
				if (!normalizedQuery) return true;
				return `${displayPropertyName(option.propertyId)} ${option.value}`
					.toLocaleLowerCase()
					.includes(normalizedQuery);
			})
			.sort(compareOptions);

		if (this.store.allOptions().length === 0) {
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
			const clear = empty.createEl('button', {
				text: 'Clear search',
				attr: { type: 'button' },
			});
			clear.addEventListener('click', () => {
				this.store.setManagerSearch('');
				if (this.renderRoot) this.renderContent(this.renderRoot);
			});
			return;
		}

		const groups = groupOptions(options);
		for (const [propertyId, propertyOptions] of groups) {
			this.renderGroup(container, propertyId, propertyOptions);
		}
	}

	private renderGroup(
		container: HTMLElement,
		propertyId: string,
		options: StoredOption[],
	): void {
		const section = container.createEl('section', { cls: 'bpc-property-group' });
		const header = section.createDiv('bpc-property-group__header');
		const heading = header.createSpan({
			text: displayPropertyName(propertyId),
			cls: 'bpc-property-group__title',
			attr: { role: 'heading', 'aria-level': '3' },
		});
		heading.title = propertyId;
		const overridden = options.some((option) => option.override !== undefined);
		if (overridden) {
			const reset = header.createEl('button', {
				text: 'Reset property',
				cls: 'bpc-property-group__reset',
				attr: { type: 'button' },
			});
			reset.addEventListener('click', () => {
				new ConfirmResetModal(
					this.app,
					`Reset colors for ${displayPropertyName(propertyId)}?`,
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

		const state = row.createSpan({ cls: 'bpc-option-row__state' });
		state.textContent = resolveColor(option, option.override).label;

		const change = row.createEl('button', {
			text: 'Change color',
			cls: 'bpc-option-row__change',
			attr: { type: 'button' },
		});
		change.addEventListener('click', () => this.popover.openAtElement(change, option));
	}
}

class ConfirmResetModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly message: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass('bpc-confirm-modal');
		this.contentEl.createEl('h2', { text: this.title });
		this.contentEl.createEl('p', { text: this.message });
		const actions = this.contentEl.createDiv('bpc-confirm-modal__actions');
		const cancel = actions.createEl('button', {
			text: 'Cancel',
			attr: { type: 'button' },
		});
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

function applyPreviewColor(element: HTMLElement, option: StoredOption): void {
	const color = resolveColor(option, option.override);
	if (color.kind === 'disabled') {
		element.classList.remove('bpc-pill--colored');
		return;
	}
	element.style.setProperty('--bpc-bg', color.background);
	element.style.setProperty('--bpc-bg-hover', color.hoverBackground);
	element.style.setProperty('--bpc-fg-light', color.foregroundLight);
	element.style.setProperty('--bpc-fg-dark', color.foregroundDark);
}

function compareOptions(first: StoredOption, second: StoredOption): number {
	return (
		first.propertyId.localeCompare(second.propertyId) ||
		first.value.localeCompare(second.value)
	);
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

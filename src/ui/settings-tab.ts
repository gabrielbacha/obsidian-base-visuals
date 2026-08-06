import { App, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import { SettingsStore } from '../core/settings-store';
import { ColorPopover } from './color-popover';
import { PillColorManagerView } from './pill-color-manager';
import { RuleManagerView } from './rule-manager';
import type BasesPillColorsPlugin from '../main';

export class BasesPillColorsSettingTab extends PluginSettingTab {
	private pillManager: PillColorManagerView | null = null;
	private ruleManager: RuleManagerView | null = null;
	private renderRoot: HTMLElement | null = null;

	constructor(
		app: App,
		plugin: BasesPillColorsPlugin,
		private readonly store: SettingsStore,
		private readonly popover: ColorPopover,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [{
			name: 'Bases Visuals manager',
			desc: 'Manage pill colors and conditional formatting.',
			aliases: this.store.allOptions().flatMap((option) => [option.propertyId, option.value]),
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass('bpc-settings-host');
				this.mount(setting.settingEl);
				return () => {
					if (this.renderRoot === setting.settingEl) this.unmount();
				};
			},
		}];
	}

	display(): void {
		this.mount(this.containerEl);
	}

	hide(): void {
		this.unmount();
	}

	private mount(container: HTMLElement): void {
		this.unmount();
		this.renderRoot = container;
		container.empty();
		container.addClass('bpc-settings');

		new Setting(container).setName('Pill colors').setHeading();
		const pillHost = container.createDiv('bpc-settings-section');
		this.pillManager = new PillColorManagerView(this.app, this.store, this.popover);
		this.pillManager.mount(pillHost);

		new Setting(container)
			.setName('Conditional formatting')
			.setHeading()
			.settingEl.addClass('bpc-settings-section-title');
		const ruleHost = container.createDiv('bpc-settings-section');
		this.ruleManager = new RuleManagerView(this.app, this.store);
		this.ruleManager.mount(ruleHost);
	}

	private unmount(): void {
		this.pillManager?.unmount();
		this.pillManager = null;
		this.ruleManager?.unmount();
		this.ruleManager = null;
		this.popover.close();
		this.renderRoot = null;
	}
}

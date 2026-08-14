import { App, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import { SettingsStore } from '../core/settings-store';
import { ColorPopover } from './color-popover';
import type BasesPillColorsPlugin from '../main';

export class BasesPillColorsSettingTab extends PluginSettingTab {
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

		new Setting(container)
			.setName('Visual settings live with each base')
			.setDesc('Open a base and choose the format button to manage its pill colors and conditional formatting. These settings are stored with the base so they travel with it.');
	}

	private unmount(): void {
		this.popover.close();
		this.renderRoot = null;
	}
}

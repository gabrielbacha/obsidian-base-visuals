import { Plugin } from 'obsidian';
import { PillEnhancer } from './core/pill-enhancer';
import { SettingsStore } from './core/settings-store';
import { ColorPopover } from './ui/color-popover';
import { BasesPillColorsSettingTab } from './ui/settings-tab';
import { RuleManagerModal } from './ui/rule-manager';

export default class BasesPillColorsPlugin extends Plugin {
	private store!: SettingsStore;
	private popover!: ColorPopover;
	private enhancer!: PillEnhancer;
	private active = false;

	async onload(): Promise<void> {
		this.active = true;
		const settings = SettingsStore.normalize(await this.loadData());
		this.store = new SettingsStore(settings, (nextSettings) =>
			this.saveData(nextSettings),
		);
		this.popover = new ColorPopover(this.store);
		this.enhancer = new PillEnhancer(
			this.app,
			this.store,
			this.popover,
			(propertyIds) => new RuleManagerModal(this.app, this.store, propertyIds).open(),
		);

		this.addSettingTab(
			new BasesPillColorsSettingTab(
				this.app,
				this,
				this.store,
				this.popover,
			),
		);

		this.app.workspace.onLayoutReady(() => {
			if (!this.active) return;
			this.enhancer.start((eventRef) => this.registerEvent(eventRef));
		});
	}

	onunload(): void {
		this.active = false;
		this.enhancer?.stop();
		this.popover?.close();
		this.store?.dispose();
	}
}

import { Plugin } from 'obsidian';
import { PillEnhancer } from './core/pill-enhancer';
import { SettingsStore } from './core/settings-store';
import { BaseVisualStoreRepository } from './core/base-visual-store';
import { ColorPopover } from './ui/color-popover';
import { ColumnPillPopover } from './ui/column-pill-popover';
import { BasesPillColorsSettingTab } from './ui/settings-tab';
import { BasesVisualsModal } from './ui/visuals-manager';

export default class BasesPillColorsPlugin extends Plugin {
	private store!: SettingsStore;
	private popover!: ColorPopover;
	private columnPopover!: ColumnPillPopover;
	private enhancer!: PillEnhancer;
	private baseStores!: BaseVisualStoreRepository;
	private active = false;

	async onload(): Promise<void> {
		this.active = true;
		const settings = SettingsStore.compactForPersistence(
			SettingsStore.normalize(await this.loadData()),
		);
		await this.saveData(settings);
		this.store = new SettingsStore(settings, (nextSettings) =>
			this.saveData(SettingsStore.compactForPersistence(nextSettings)),
		);
		this.baseStores = new BaseVisualStoreRepository(this.app, this.store);
		this.popover = new ColorPopover(this.store);
		this.columnPopover = new ColumnPillPopover(this.app, this.store);
		this.enhancer = new PillEnhancer(
			this.app,
			this.store,
			(propertyIds, scope) => new BasesVisualsModal(
				this.app,
				scope ? this.baseStores.forScope(scope) : this.store,
				this.popover,
				propertyIds,
				'pill-colors',
				scope,
				scope ? this.baseStores.propertyIdsForScope(scope, propertyIds) : undefined,
				scope ? this.baseStores.rulePropertyIdsForScope(scope, propertyIds) : undefined,
			).open(),
			(request) => {
				this.popover.close();
				this.columnPopover.open(request);
			},
			(scope) => this.baseStores.forScope(scope),
			this.baseStores,
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
		this.columnPopover?.close();
		void this.baseStores?.dispose();
		this.store?.dispose();
	}
}

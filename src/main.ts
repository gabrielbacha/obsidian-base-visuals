import { Notice, Plugin } from 'obsidian';
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
		const raw: unknown = await this.loadData();
		if (SettingsStore.futureVersion(raw)) {
			this.active = false;
			new Notice('These settings need a newer plugin version. Update the plugin to edit them. The saved settings were kept.');
			return;
		}
		const settings = SettingsStore.compactForPersistence(
			SettingsStore.normalize(raw),
		);
		this.store = new SettingsStore(settings, (nextSettings) =>
			this.saveData(SettingsStore.persistenceSnapshot(SettingsStore.compactForPersistence(nextSettings))),
			() => new Notice('Could not save settings. Your changes remain in memory. Keep Obsidian open and change a setting to retry.'),
		);
		this.baseStores = new BaseVisualStoreRepository(this.app, this.store);
		this.baseStores.watch((eventRef) => this.registerEvent(eventRef));
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
		// Obsidian's unload hook cannot wait; the retained stores own the final queued writes.
		void this.finishSettingsWrites();
	}

	async finishSettingsWrites(): Promise<void> {
		await Promise.all([
			this.baseStores?.dispose().catch(() => new Notice('Could not save base settings before closing.')),
			this.store?.dispose(),
		]);
	}
}

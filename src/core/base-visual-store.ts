import { parseYaml, stringifyYaml, type App } from 'obsidian';
import { getNativeBaseFile, getNativeViewConfig, type NativeViewConfig } from './native-table-view';
import { SettingsStore } from './settings-store';
import {
	DEFAULT_SETTINGS,
	type BasesPillColorsSettings,
	type ConditionalRule,
	type StoredOption,
} from './types';

export const BASE_VISUALS_KEY = 'basesVisualsBase';
export const VIEW_VISUALS_KEY = 'basesVisualsView';

interface BaseVisualData {
	schemaVersion: 3;
	options: Record<string, StoredOption>;
	knownProperties: Record<string, { propertyId: string }>;
	rules: ConditionalRule[];
	propertyStrategies: BasesPillColorsSettings['propertyStrategies'];
	columnAppearances?: Record<string, unknown>;
}

interface ViewVisualData {
	schemaVersion: 1;
	rules: ConditionalRule[];
}

export class BaseVisualStoreRepository {
	private readonly stores = new WeakMap<NativeViewConfig, SettingsStore>();
	private readonly liveStores = new Set<SettingsStore>();
	private readonly scopeByStore = new WeakMap<SettingsStore, HTMLElement>();
	private readonly unsubscribers = new Map<SettingsStore, () => void>();

	constructor(
		private readonly app: App,
		private readonly globalStore: SettingsStore,
	) {}

	forScope(scope: HTMLElement): SettingsStore {
		const config = getNativeViewConfig(this.app, scope);
		if (!config) return this.globalStore;
		const existing = this.stores.get(config);
		if (existing) return existing;

		const storedBase = normalizeBaseData(config.get(BASE_VISUALS_KEY));
		const base = storedBase ?? migrateGlobalVisuals(this.globalStore.settings);
		const view = normalizeViewData(config.get(VIEW_VISUALS_KEY));
		const settings = scopedSettings(this.globalStore.settings, base, view);
		const store = new SettingsStore(settings, async (next) => {
			this.globalStore.setManagerSearch(next.managerSearch);
			this.globalStore.setRuleManagerSearch(next.ruleManagerSearch);
			const nextBase = baseDataFromSettings(next, config.get(BASE_VISUALS_KEY));
			const nextView = viewDataFromSettings(next);
			config.set(BASE_VISUALS_KEY, nextBase);
			config.set(VIEW_VISUALS_KEY, nextView.rules.length ? nextView : null);
			await this.syncBaseViews(scope, nextBase);
		});
		this.stores.set(config, store);
		this.liveStores.add(store);
		this.scopeByStore.set(store, scope);
		this.unsubscribers.set(store, store.subscribe(() => this.globalStore.notify()));
		if (!storedBase) void this.hydrateOrMigrate(scope, config, store, base);
		return store;
	}

	getBaseColumnAppearances(scope: HTMLElement): Record<string, unknown> {
		const config = getNativeViewConfig(this.app, scope);
		const base = normalizeBaseData(config?.get(BASE_VISUALS_KEY));
		return { ...(base?.columnAppearances ?? {}) };
	}

	setBaseColumnAppearance(scope: HTMLElement, propertyId: string, value: unknown): boolean {
		const config = getNativeViewConfig(this.app, scope);
		if (!config) return false;
		const store = this.forScope(scope);
		const base = baseDataFromSettings(store.settings, config.get(BASE_VISUALS_KEY));
		const appearances = { ...(base.columnAppearances ?? {}) };
		if (value === null) delete appearances[propertyId];
		else appearances[propertyId] = value;
		base.columnAppearances = appearances;
		config.set(BASE_VISUALS_KEY, base);
		void this.syncBaseViews(scope, base);
		this.globalStore.notify();
		return true;
	}

	async dispose(): Promise<void> {
		for (const unsubscribe of this.unsubscribers.values()) unsubscribe();
		this.unsubscribers.clear();
		await Promise.all([...this.liveStores].map((store) => store.flush()));
		this.liveStores.clear();
	}

	private async hydrateOrMigrate(
		scope: HTMLElement,
		config: NativeViewConfig,
		store: SettingsStore,
		fallback: BaseVisualData,
	): Promise<void> {
		const sibling = await this.readSiblingBaseData(scope);
		if (sibling) {
			const viewRules = store.settings.rules.filter((rule) => rule.scope === 'view');
			store.settings.options = {
				...store.settings.options,
				...structuredClone(sibling.options),
			};
			store.settings.knownProperties = {
				...store.settings.knownProperties,
				...structuredClone(sibling.knownProperties),
			};
			store.settings.rules = [...structuredClone(sibling.rules), ...viewRules];
			store.settings.propertyStrategies = structuredClone(sibling.propertyStrategies);
			config.set(BASE_VISUALS_KEY, sibling);
			this.globalStore.notify();
			return;
		}
		const migrated = baseDataFromSettings(store.settings, fallback);
		config.set(BASE_VISUALS_KEY, migrated);
		await this.syncBaseViews(scope, migrated);
	}

	private async readSiblingBaseData(scope: HTMLElement): Promise<BaseVisualData | null> {
		const file = getNativeBaseFile(this.app, scope);
		if (!file || !this.app.vault?.cachedRead) return null;
		try {
			const parsed = parseYaml(await this.app.vault.cachedRead(file)) as Record<string, unknown> | null;
			if (!parsed || !Array.isArray(parsed.views)) return null;
			for (const candidate of parsed.views) {
				if (!isRecord(candidate)) continue;
				const data = normalizeBaseData(candidate[BASE_VISUALS_KEY]);
				if (data) return data;
			}
		} catch {
			return null;
		}
		return null;
	}

	private async syncBaseViews(scope: HTMLElement, data: BaseVisualData): Promise<void> {
		const file = getNativeBaseFile(this.app, scope);
		if (!file || !this.app.vault?.process) return;
		try {
			await this.app.vault.process(file, (source) => {
				const parsed = parseYaml(source) as Record<string, unknown> | null;
				if (!parsed || !Array.isArray(parsed.views)) return source;
				let changed = false;
				for (const candidate of parsed.views) {
					if (!isRecord(candidate)) continue;
					if (JSON.stringify(candidate[BASE_VISUALS_KEY]) === JSON.stringify(data)) continue;
					candidate[BASE_VISUALS_KEY] = data;
					changed = true;
				}
				return changed ? stringifyYaml(parsed) : source;
			});
		} catch {
			// The active view config remains persisted even if the backing file
			// cannot be synchronized (for example, a read-only embedded Base).
		}
	}
}

function scopedSettings(
	global: BasesPillColorsSettings,
	base: BaseVisualData,
	view: ViewVisualData,
): BasesPillColorsSettings {
	return {
		...structuredClone(DEFAULT_SETTINGS),
		options: structuredClone(base.options),
		knownProperties: structuredClone(base.knownProperties),
		propertyStrategies: structuredClone(base.propertyStrategies),
		rules: [...structuredClone(base.rules), ...structuredClone(view.rules)],
		managerSearch: global.managerSearch,
		ruleManagerSearch: global.ruleManagerSearch,
		layoutPresets: [],
		lastColumnWidthPreset: global.lastColumnWidthPreset,
	};
}

function migrateGlobalVisuals(global: BasesPillColorsSettings): BaseVisualData {
	return {
		schemaVersion: 3,
		options: structuredClone(global.options),
		knownProperties: structuredClone(global.knownProperties),
		rules: global.rules.map((rule) => ({ ...structuredClone(rule), scope: 'base' })),
		propertyStrategies: structuredClone(global.propertyStrategies),
	};
}

function baseDataFromSettings(settings: BasesPillColorsSettings, current: unknown): BaseVisualData {
	const previous = normalizeBaseData(current);
	return {
		schemaVersion: 3,
		options: structuredClone(settings.options),
		knownProperties: structuredClone(settings.knownProperties),
		rules: settings.rules.filter((rule) => rule.scope === 'base').map((rule) => structuredClone(rule)),
		propertyStrategies: structuredClone(settings.propertyStrategies),
		...(previous?.columnAppearances ? { columnAppearances: structuredClone(previous.columnAppearances) } : {}),
	};
}

function viewDataFromSettings(settings: BasesPillColorsSettings): ViewVisualData {
	return {
		schemaVersion: 1,
		rules: settings.rules.filter((rule) => rule.scope === 'view').map((rule) => structuredClone(rule)),
	};
}

function normalizeBaseData(value: unknown): BaseVisualData | null {
	if (!isRecord(value)) return null;
	const normalized = SettingsStore.normalize({
		options: value.options,
		knownProperties: value.knownProperties,
		rules: value.rules,
		propertyStrategies: value.propertyStrategies,
	});
	return {
		schemaVersion: 3,
		options: normalized.options,
		knownProperties: normalized.knownProperties,
		rules: normalized.rules.map((rule) => ({ ...rule, scope: 'base' })),
		propertyStrategies: normalized.propertyStrategies,
		...(isRecord(value.columnAppearances) ? { columnAppearances: structuredClone(value.columnAppearances) } : {}),
	};
}

function normalizeViewData(value: unknown): ViewVisualData {
	if (!isRecord(value)) return { schemaVersion: 1, rules: [] };
	const normalized = SettingsStore.normalize({ rules: value.rules });
	return {
		schemaVersion: 1,
		rules: normalized.rules.map((rule) => ({ ...rule, scope: 'view' })),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

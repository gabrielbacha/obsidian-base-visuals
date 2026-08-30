import { parseYaml, stringifyYaml, type App } from 'obsidian';
import {
	getNativeBaseFile,
	COLUMN_APPEARANCE_CONFIG_KEY,
	getNativePropertyDisplayName,
	getNativePropertyIds,
	getNativePropertyKind,
	getNativeViewConfig,
	resolveNativePropertyId,
	type NativeViewConfig,
} from './native-table-view';
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
	schemaVersion: 6;
	paletteTemplateId: BasesPillColorsSettings['paletteTemplateId'];
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
	private readonly propertyContexts = new WeakMap<HTMLElement, Promise<BasePropertyContext>>();
	private readonly canonicalProperties = new WeakMap<HTMLElement, Map<string, string>>();

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
		if (!storedBase) {
			void this.hydrateOrMigrate(scope, config, store, base)
				.then(() => this.initializePropertyIdentity(scope, config, store));
		} else void this.initializePropertyIdentity(scope, config, store);
		return store;
	}

	resolvePropertyId(scope: HTMLElement, propertyId: string): string {
		const native = resolveNativePropertyId(this.app, scope, propertyId) ?? propertyId.trim();
		const aliases = this.canonicalProperties.get(scope);
		return aliases?.get(propertyId) ?? aliases?.get(native) ?? native;
	}

	async propertyIdsForScope(
		scope: HTMLElement,
		fallback: readonly string[] = [],
	): Promise<ReadonlySet<string>> {
		const context = await this.propertyContext(scope);
		const ids = new Set(context.listPropertyIds);
		for (const propertyId of context.referencedPropertyIds) {
			if (!context.nonListPropertyIds.has(propertyId)) ids.add(propertyId);
		}
		for (const propertyId of getNativePropertyIds(this.app, scope)) {
			if (getNativePropertyKind(this.app, scope, propertyId) === 'list') {
				ids.add(resolveWithAliases(context.aliases, propertyId));
			}
		}
		for (const propertyId of fallback) {
			if (getNativePropertyKind(this.app, scope, propertyId) === 'list') {
				ids.add(resolveWithAliases(context.aliases, propertyId));
			}
		}
		return ids;
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
			store.settings.paletteTemplateId = sibling.paletteTemplateId;
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

	private async initializePropertyIdentity(
		scope: HTMLElement,
		config: NativeViewConfig,
		store: SettingsStore,
	): Promise<void> {
		const context = await this.propertyContext(scope);
		this.canonicalProperties.set(scope, context.aliases);
		const resolve = (propertyId: string) => resolveWithAliases(context.aliases, propertyId);
		const rawBase = config.get(BASE_VISUALS_KEY);
		let current = normalizeBaseData(rawBase);
		let baseChanged = isRecord(rawBase) && rawBase.schemaVersion !== 6;
		if (current?.columnAppearances) {
			const columnAppearances = rekeyRecord(current.columnAppearances, resolve);
			if (JSON.stringify(columnAppearances) !== JSON.stringify(current.columnAppearances)) {
				current = { ...current, columnAppearances };
				baseChanged = true;
			}
		}
		const viewAppearances = config.get(COLUMN_APPEARANCE_CONFIG_KEY);
		if (isRecord(viewAppearances)) {
			const canonicalAppearances = rekeyRecord(viewAppearances, resolve);
			if (JSON.stringify(canonicalAppearances) !== JSON.stringify(viewAppearances)) {
				config.set(COLUMN_APPEARANCE_CONFIG_KEY, canonicalAppearances);
			}
		}
		if (current && baseChanged) config.set(BASE_VISUALS_KEY, current);
		const storeChanged = store.rekeyProperties(resolve);
		if (current && baseChanged && !storeChanged) {
			await this.syncBaseViews(scope, current);
		}
		this.globalStore.notify();
	}

	private propertyContext(scope: HTMLElement): Promise<BasePropertyContext> {
		const existing = this.propertyContexts.get(scope);
		if (existing) return existing;
		const pending = loadBasePropertyContext(this.app, scope);
		this.propertyContexts.set(scope, pending);
		return pending;
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
		paletteTemplateId: base.paletteTemplateId,
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
		schemaVersion: 6,
		paletteTemplateId: global.paletteTemplateId,
		options: structuredClone(global.options),
		knownProperties: structuredClone(global.knownProperties),
		rules: global.rules.map((rule) => ({ ...structuredClone(rule), scope: 'base' })),
		propertyStrategies: structuredClone(global.propertyStrategies),
	};
}

function baseDataFromSettings(settings: BasesPillColorsSettings, current: unknown): BaseVisualData {
	const previous = normalizeBaseData(current);
	return {
		schemaVersion: 6,
		paletteTemplateId: settings.paletteTemplateId,
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
		paletteTemplateId: value.paletteTemplateId,
		options: value.options,
		knownProperties: value.knownProperties,
		rules: value.rules,
		propertyStrategies: value.propertyStrategies,
	});
	return {
		schemaVersion: 6,
		paletteTemplateId: normalized.paletteTemplateId,
		options: normalized.options,
		knownProperties: normalized.knownProperties,
		rules: normalized.rules.map((rule) => ({ ...rule, scope: 'base' })),
		propertyStrategies: normalized.propertyStrategies,
		...(isRecord(value.columnAppearances) ? { columnAppearances: structuredClone(value.columnAppearances) } : {}),
	};
}

interface BasePropertyContext {
	aliases: Map<string, string>;
	listPropertyIds: Set<string>;
	nonListPropertyIds: Set<string>;
	referencedPropertyIds: Set<string>;
}

async function loadBasePropertyContext(app: App, scope: HTMLElement): Promise<BasePropertyContext> {
	const aliases = new Map<string, string>();
	const listPropertyIds = new Set<string>();
	const nonListPropertyIds = new Set<string>();
	const nativeIds = getNativePropertyIds(app, scope);
	for (const propertyId of nativeIds) {
		aliases.set(propertyId, propertyId);
		const displayName = getNativePropertyDisplayName(app, scope, propertyId);
		if (displayName) aliases.set(displayName, propertyId);
	}

	const file = getNativeBaseFile(app, scope);
	if (!file || !app.vault?.cachedRead) {
		return { aliases, listPropertyIds, nonListPropertyIds, referencedPropertyIds: new Set() };
	}
	try {
		const parsed = parseYaml(await app.vault.cachedRead(file)) as Record<string, unknown> | null;
		if (!parsed) return { aliases, listPropertyIds, nonListPropertyIds, referencedPropertyIds: new Set() };
		const definitions = isRecord(parsed.properties) ? parsed.properties : {};
		const lowerAliases = new Map<string, string | null>();
		for (const [name, definition] of Object.entries(definitions)) {
			const canonical = canonicalDefinitionId(name);
			registerAlias(aliases, lowerAliases, name, canonical);
			registerAlias(aliases, lowerAliases, canonical, canonical);
			if (isRecord(definition) && typeof definition.displayName === 'string') {
				registerAlias(aliases, lowerAliases, definition.displayName, canonical);
			}
			if (isListDefinition(definition)) listPropertyIds.add(canonical);
			else if (isTypedDefinition(definition)) nonListPropertyIds.add(canonical);
		}
		for (const [alias, canonical] of lowerAliases) {
			if (canonical) aliases.set(alias, canonical);
		}
		for (const alias of [...aliases.keys()]) {
			const canonical = lowerAliases.get(alias.replace(/^note\./, '').toLocaleLowerCase());
			if (canonical) aliases.set(alias, canonical);
		}
		for (const [alias, canonical] of [...aliases]) {
			aliases.set(`note.${alias}`.replace(/^note\.note\./, 'note.'), canonical);
		}
		const referencedPropertyIds = new Set(
			collectViewPropertyReferences(parsed.views).map((propertyId) =>
				resolveWithAliases(aliases, canonicalDefinitionId(propertyId))),
		);
		return { aliases, listPropertyIds, nonListPropertyIds, referencedPropertyIds };
	} catch {
		return { aliases, listPropertyIds, nonListPropertyIds, referencedPropertyIds: new Set() };
	}
}

function canonicalDefinitionId(name: string): string {
	const trimmed = name.trim();
	return /^(?:note|file|formula)\./.test(trimmed) ? trimmed : `note.${trimmed}`;
}

function isListDefinition(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (isRecord(value.options) || Array.isArray(value.options)) return true;
	if (typeof value.type !== 'string') return false;
	return ['select', 'multi', 'multiselect', 'list', 'tags'].includes(value.type.toLocaleLowerCase());
}

function isTypedDefinition(value: unknown): boolean {
	return isRecord(value) && typeof value.type === 'string';
}

function collectViewPropertyReferences(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const references = new Set<string>();
	const visit = (candidate: unknown, key?: string): void => {
		if (typeof candidate === 'string') {
			if (key === 'property' || key === 'order') references.add(candidate);
			return;
		}
		if (Array.isArray(candidate)) {
			for (const item of candidate) visit(item, key);
			return;
		}
		if (!isRecord(candidate)) return;
		if (key === 'order') {
			const id = typeof candidate.id === 'string'
				? candidate.id
				: typeof candidate.property === 'string' ? candidate.property : '';
			if (id) references.add(id);
		}
		for (const [childKey, child] of Object.entries(candidate)) {
			if (childKey === 'order' || childKey === 'property') visit(child, childKey);
			else if (childKey === 'sort' || childKey === 'groupBy') visit(child);
		}
	};
	for (const view of value) visit(view);
	return [...references];
}

function registerAlias(
	aliases: Map<string, string>,
	lowerAliases: Map<string, string | null>,
	alias: string,
	canonical: string,
): void {
	const trimmed = alias.trim();
	if (!trimmed) return;
	aliases.set(trimmed, canonical);
	const lower = trimmed.toLocaleLowerCase();
	const existing = lowerAliases.get(lower);
	lowerAliases.set(lower, existing === undefined || existing === canonical ? canonical : null);
}

function resolveWithAliases(aliases: Map<string, string>, propertyId: string): string {
	const trimmed = propertyId.trim();
	return aliases.get(trimmed)
		?? aliases.get(trimmed.replace(/^note\./, ''))
		?? aliases.get(trimmed.toLocaleLowerCase())
		?? aliases.get(trimmed.replace(/^note\./, '').toLocaleLowerCase())
		?? trimmed;
}

function rekeyRecord(value: Record<string, unknown>, resolve: (propertyId: string) => string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const entries = Object.entries(value).sort(([first], [second]) =>
		Number(resolve(first) !== first) - Number(resolve(second) !== second));
	for (const [propertyId, item] of entries) {
		const canonical = resolve(propertyId);
		if (!(canonical in result)) result[canonical] = item;
	}
	return result;
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

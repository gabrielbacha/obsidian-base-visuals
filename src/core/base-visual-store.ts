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

type BaseGroupKey = string | NativeViewConfig;

interface StoreRecord {
	store: SettingsStore;
	scope: HTMLElement;
	config: NativeViewConfig;
	group: BaseStoreGroup;
	baseSnapshot: BaseVisualData;
}

interface BaseStoreGroup {
	base: BaseVisualData;
	records: Set<StoreRecord>;
	pendingSync: { scope: HTMLElement; data: BaseVisualData } | null;
	syncPromise: Promise<void> | null;
}

export class BaseVisualStoreRepository {
	private readonly stores = new WeakMap<NativeViewConfig, SettingsStore>();
	private readonly storesByScope = new WeakMap<HTMLElement, SettingsStore>();
	private readonly liveStores = new Set<SettingsStore>();
	private readonly recordsByStore = new Map<SettingsStore, StoreRecord>();
	private readonly groups = new Map<BaseGroupKey, BaseStoreGroup>();
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
		const scoped = this.storesByScope.get(scope);
		if (scoped) {
			const record = this.recordsByStore.get(scoped);
			if (record) {
				record.config = config;
				this.stores.set(config, scoped);
				config.set(BASE_VISUALS_KEY, structuredClone(record.group.base));
			}
			return scoped;
		}

		const storedBase = normalizeBaseData(config.get(BASE_VISUALS_KEY));
		const fallback = storedBase ?? migrateGlobalVisuals(this.globalStore.settings);
		const group = this.getOrCreateGroup(scope, config, fallback);
		const base = group.base;
		const view = normalizeViewData(config.get(VIEW_VISUALS_KEY));
		const settings = scopedSettings(this.globalStore.settings, base, view);
		let record!: StoreRecord;
		const store = new SettingsStore(settings, async (next) => {
			this.globalStore.setManagerSearch(next.managerSearch);
			this.globalStore.setRuleManagerSearch(next.ruleManagerSearch);
			const localBase = baseDataFromSettings(next, record.baseSnapshot);
			const nextBase = mergeBaseChanges(record.baseSnapshot, localBase, group.base);
			const nextView = viewDataFromSettings(next);
			record.config.set(VIEW_VISUALS_KEY, nextView.rules.length ? nextView : null);
			this.publishBase(group, nextBase, record);
			await this.queueBaseSync(group, scope, nextBase);
		});
		record = {
			store, scope, config, group,
			baseSnapshot: structuredClone(base),
		};
		this.stores.set(config, store);
		this.storesByScope.set(scope, store);
		this.liveStores.add(store);
		this.recordsByStore.set(store, record);
		group.records.add(record);
		if (!deepEqual(storedBase, base)) {
			config.set(BASE_VISUALS_KEY, structuredClone(base));
		}
		this.unsubscribers.set(store, store.subscribe(() => this.globalStore.notify()));
		if (!storedBase) {
			void this.hydrateOrMigrate(scope, record, fallback)
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

	/** Every canonical property declared or referenced by any view in the current Base. */
	async rulePropertyIdsForScope(
		scope: HTMLElement,
		fallback: readonly string[] = [],
	): Promise<ReadonlySet<string>> {
		const context = await this.propertyContext(scope);
		const ids = new Set<string>();
		for (const propertyId of context.definedPropertyIds) ids.add(propertyId);
		for (const propertyId of context.referencedPropertyIds) ids.add(propertyId);
		for (const propertyId of getNativePropertyIds(this.app, scope)) {
			ids.add(resolveWithAliases(context.aliases, propertyId));
		}
		for (const propertyId of fallback) {
			ids.add(resolveWithAliases(context.aliases, propertyId));
		}
		return ids;
	}

	getBaseColumnAppearances(scope: HTMLElement): Record<string, unknown> {
		const config = getNativeViewConfig(this.app, scope);
		const store = config ? this.stores.get(config) : undefined;
		const base = store
			? this.recordsByStore.get(store)?.group.base
			: normalizeBaseData(config?.get(BASE_VISUALS_KEY));
		return { ...(base?.columnAppearances ?? {}) };
	}

	setBaseColumnAppearance(scope: HTMLElement, propertyId: string, value: unknown): boolean {
		const config = getNativeViewConfig(this.app, scope);
		if (!config) return false;
		const store = this.forScope(scope);
		const record = this.recordsByStore.get(store);
		if (!record) return false;
		const base = structuredClone(record.group.base);
		const appearances = { ...(base.columnAppearances ?? {}) };
		if (value === null) delete appearances[propertyId];
		else appearances[propertyId] = value;
		base.columnAppearances = appearances;
		this.publishBase(record.group, base);
		void this.queueBaseSync(record.group, scope, base);
		return true;
	}

	async dispose(): Promise<void> {
		for (const unsubscribe of this.unsubscribers.values()) unsubscribe();
		this.unsubscribers.clear();
		await Promise.all([...this.liveStores].map((store) => store.flush()));
		await Promise.all([...this.groups.values()].flatMap((group) =>
			group.syncPromise ? [group.syncPromise] : []));
		this.liveStores.clear();
		this.recordsByStore.clear();
		this.groups.clear();
	}

	private async hydrateOrMigrate(
		scope: HTMLElement,
		record: StoreRecord,
		fallback: BaseVisualData,
	): Promise<void> {
		const sibling = await this.readSiblingBaseData(scope);
		const group = record.group;
		const hydrated = sibling
			? mergeBaseChanges(fallback, group.base, sibling)
			: group.base;
		this.publishBase(group, hydrated);
		await this.queueBaseSync(group, scope, hydrated);
	}

	private getOrCreateGroup(
		scope: HTMLElement,
		config: NativeViewConfig,
		initial: BaseVisualData,
	): BaseStoreGroup {
		const file = getNativeBaseFile(this.app, scope);
		const key: BaseGroupKey = file?.path ? `file:${file.path}` : config;
		const existing = this.groups.get(key);
		if (existing) return existing;
		const group: BaseStoreGroup = {
			base: structuredClone(initial),
			records: new Set(),
			pendingSync: null,
			syncPromise: null,
		};
		this.groups.set(key, group);
		return group;
	}

	private publishBase(
		group: BaseStoreGroup,
		data: BaseVisualData,
		source?: StoreRecord,
	): void {
		group.base = structuredClone(data);
		for (const record of group.records) {
			if (record === source) {
				record.baseSnapshot = structuredClone(data);
				applyBaseToSettings(record.store.settings, data);
				record.config.set(BASE_VISUALS_KEY, structuredClone(data));
				record.store.notify();
				continue;
			}
			const local = baseDataFromSettings(record.store.settings, record.baseSnapshot);
			const projected = mergeBaseChanges(record.baseSnapshot, local, data);
			record.baseSnapshot = structuredClone(data);
			applyBaseToSettings(record.store.settings, projected);
			record.config.set(BASE_VISUALS_KEY, structuredClone(data));
			record.store.notify();
		}
		this.globalStore.notify();
	}

	private queueBaseSync(
		group: BaseStoreGroup,
		scope: HTMLElement,
		data: BaseVisualData,
	): Promise<void> {
		group.pendingSync = { scope, data: structuredClone(data) };
		if (!group.syncPromise) {
			group.syncPromise = this.drainBaseSync(group).finally(() => {
				group.syncPromise = null;
			});
		}
		return group.syncPromise;
	}

	private async drainBaseSync(group: BaseStoreGroup): Promise<void> {
		while (group.pendingSync) {
			const pending = group.pendingSync;
			group.pendingSync = null;
			await this.syncBaseViews(pending.scope, pending.data);
		}
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
		const storeChanged = store.rekeyProperties(resolve);
		if (current && baseChanged) {
			const record = this.recordsByStore.get(store);
			if (record) {
				const merged = mergeBaseChanges(record.baseSnapshot, current, record.group.base);
				this.publishBase(record.group, merged);
				await this.queueBaseSync(record.group, scope, merged);
			} else config.set(BASE_VISUALS_KEY, current);
		}
		if (storeChanged) await store.flush();
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
	const normalizedRules = SettingsStore.normalize({ rules: global.rules }).rules;
	return {
		schemaVersion: 6,
		paletteTemplateId: global.paletteTemplateId,
		options: structuredClone(global.options),
		knownProperties: structuredClone(global.knownProperties),
		rules: normalizedRules.map((rule) => ({ ...structuredClone(rule), scope: 'base' })),
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

function mergeBaseChanges(
	previous: BaseVisualData,
	next: BaseVisualData,
	current: BaseVisualData,
): BaseVisualData {
	const merged: BaseVisualData = {
		...structuredClone(current),
		paletteTemplateId: deepEqual(previous.paletteTemplateId, next.paletteTemplateId)
			? current.paletteTemplateId
			: next.paletteTemplateId,
		options: mergeRecordChanges(previous.options, next.options, current.options),
		knownProperties: mergeRecordChanges(
			previous.knownProperties,
			next.knownProperties,
			current.knownProperties,
		),
		rules: mergeRuleChanges(previous.rules, next.rules, current.rules),
		propertyStrategies: mergeRecordChanges(
			previous.propertyStrategies,
			next.propertyStrategies,
			current.propertyStrategies,
		),
	};
	const appearances = mergeRecordChanges(
		previous.columnAppearances ?? {},
		next.columnAppearances ?? {},
		current.columnAppearances ?? {},
	);
	if (Object.keys(appearances).length) merged.columnAppearances = appearances;
	else delete merged.columnAppearances;
	return merged;
}

function mergeRecordChanges<T>(
	previous: Record<string, T>,
	next: Record<string, T>,
	current: Record<string, T>,
): Record<string, T> {
	const merged = structuredClone(current);
	for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
		if (deepEqual(previous[key], next[key])) continue;
		if (key in next) merged[key] = structuredClone(next[key] as T);
		else delete merged[key];
	}
	return merged;
}

function mergeRuleChanges(
	previous: ConditionalRule[],
	next: ConditionalRule[],
	current: ConditionalRule[],
): ConditionalRule[] {
	if (deepEqual(previous, next)) return structuredClone(current);
	const previousById = new Map(previous.map((rule) => [rule.id, rule]));
	const nextById = new Map(next.map((rule) => [rule.id, rule]));
	const mergedById = new Map(current.map((rule) => [rule.id, structuredClone(rule)]));
	for (const id of previousById.keys()) {
		if (!nextById.has(id)) mergedById.delete(id);
	}
	for (const rule of next) {
		if (!deepEqual(previousById.get(rule.id), rule)) {
			mergedById.set(rule.id, structuredClone(rule));
		}
	}
	const orderChanged = !deepEqual(
		previous.map((rule) => rule.id),
		next.map((rule) => rule.id),
	);
	const order = orderChanged
		? [...next.map((rule) => rule.id), ...current.map((rule) => rule.id)]
		: current.map((rule) => rule.id);
	return [...new Set(order)].flatMap((id) => {
		const rule = mergedById.get(id);
		return rule ? [rule] : [];
	});
}

function applyBaseToSettings(
	settings: BasesPillColorsSettings,
	base: BaseVisualData,
): void {
	const viewRules = settings.rules.filter((rule) => rule.scope === 'view');
	settings.paletteTemplateId = base.paletteTemplateId;
	settings.options = structuredClone(base.options);
	settings.knownProperties = structuredClone(base.knownProperties);
	settings.propertyStrategies = structuredClone(base.propertyStrategies);
	settings.rules = [...structuredClone(base.rules), ...viewRules];
}

function deepEqual(first: unknown, second: unknown): boolean {
	return JSON.stringify(first) === JSON.stringify(second);
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
	definedPropertyIds: Set<string>;
	listPropertyIds: Set<string>;
	nonListPropertyIds: Set<string>;
	referencedPropertyIds: Set<string>;
}

async function loadBasePropertyContext(app: App, scope: HTMLElement): Promise<BasePropertyContext> {
	const aliases = new Map<string, string>();
	const definedPropertyIds = new Set<string>();
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
		return { aliases, definedPropertyIds, listPropertyIds, nonListPropertyIds, referencedPropertyIds: new Set() };
	}
	try {
		const parsed = parseYaml(await app.vault.cachedRead(file)) as Record<string, unknown> | null;
		if (!parsed) return { aliases, definedPropertyIds, listPropertyIds, nonListPropertyIds, referencedPropertyIds: new Set() };
		const definitions = isRecord(parsed.properties) ? parsed.properties : {};
		const lowerAliases = new Map<string, string | null>();
		for (const [name, definition] of Object.entries(definitions)) {
			const canonical = canonicalDefinitionId(name);
			definedPropertyIds.add(canonical);
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
		return { aliases, definedPropertyIds, listPropertyIds, nonListPropertyIds, referencedPropertyIds };
	} catch {
		return { aliases, definedPropertyIds, listPropertyIds, nonListPropertyIds, referencedPropertyIds: new Set() };
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

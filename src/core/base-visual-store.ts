import { Notice, parseYaml, type App, type EventRef } from 'obsidian';
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
	BASE_VISUALS_KEY,
	BASE_VISUALS_SCHEMA_VERSION,
	canonicalPropertyId,
	compactViewData,
	emptyBaseData,
	equalValues,
	hasExtensionChoices,
	isNewerVisualSchema,
	LEGACY_BASE_VISUALS_KEY,
	mergeBaseChanges,
	mergeViewChanges,
	normalizeBaseData,
	normalizeViewData,
	readYamlMap,
	VIEW_VISUALS_KEY,
	VIEW_VISUALS_SCHEMA_VERSION,
	writeBaseVisuals,
	writeViewVisuals,
	declaredPropertyTypes,
	setDeclaredOptionColor,
	type BaseVisualData,
	type DeclaredOption,
	type OptionIdentity,
	type BlockWriteResult,
	type ViewVisualData,
} from '@gabrielbacha/bases-contract';
import { DEFAULT_SETTINGS, type BasesPillColorsSettings } from './types';

export { BASE_VISUALS_KEY, LEGACY_BASE_VISUALS_KEY, VIEW_VISUALS_KEY };

export type VisualPersistenceState =
	| { status: 'saved' }
	| { status: 'pending' }
	| { status: 'conflict'; paths: string[] }
	| { status: 'read-only'; reason: string }
	| { status: 'failed'; reason: string };

type BaseGroupKey = string | NativeViewConfig;

interface StoreRecord {
	store: SettingsStore;
	scope: HTMLElement;
	config: NativeViewConfig;
	group: BaseStoreGroup;
	baseSnapshot: BaseVisualData;
	viewSnapshot: ViewVisualData;
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
	private readonly persistenceStates = new WeakMap<HTMLElement, VisualPersistenceState>();

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
			}
			return scoped;
		}

		const storedBase = normalizeBaseData(config.get(LEGACY_BASE_VISUALS_KEY));
		const fallback = storedBase ?? emptyBaseData();
		const group = this.getOrCreateGroup(scope, config, fallback);
		const base = group.base;
		const view = normalizeViewData(
			config.get(VIEW_VISUALS_KEY),
			config.get(COLUMN_APPEARANCE_CONFIG_KEY),
		);
		const settings = scopedSettings(this.globalStore.settings, base, view);
		let record!: StoreRecord;
		const store = new SettingsStore(settings, async (next) => {
			this.globalStore.setManagerSearch(next.managerSearch);
			this.globalStore.setRuleManagerSearch(next.ruleManagerSearch);
			this.globalStore.setCollapsedPropertyGroups(next.collapsedPropertyGroups);
			const localBase = baseDataFromSettings(
				next,
				record.baseSnapshot,
				this.globalStore.settings.paletteTemplateId,
			);
			const nextBase = mergeBaseChanges(record.baseSnapshot, localBase, group.base);
			const localView = viewDataFromSettings(next, record.viewSnapshot);
			const latestView = normalizeViewData(
				record.config.get(VIEW_VISUALS_KEY),
				record.config.get(COLUMN_APPEARANCE_CONFIG_KEY),
			);
			const nextView = mergeViewChanges(record.viewSnapshot, localView, latestView);
			const persistedView = await this.syncView(record, nextView);
			if (persistedView) record.viewSnapshot = structuredClone(persistedView);
			this.publishBase(group, nextBase, record);
			await this.queueBaseSync(group, scope, nextBase);
		});
		record = {
			store, scope, config, group,
			baseSnapshot: structuredClone(base),
			viewSnapshot: structuredClone(view),
		};
		this.stores.set(config, store);
		this.storesByScope.set(scope, store);
		this.liveStores.add(store);
		this.recordsByStore.set(store, record);
		group.records.add(record);
		this.unsubscribers.set(store, store.subscribe(() => this.globalStore.notify()));
		void this.hydrateOrMigrate(scope, record, fallback)
			.then(() => this.initializePropertyIdentity(scope, config, store));
		return store;
	}

	getPersistenceState(scope: HTMLElement): VisualPersistenceState {
		return this.persistenceStates.get(scope) ?? { status: 'saved' };
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
			: normalizeBaseData(config?.get(LEGACY_BASE_VISUALS_KEY));
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

	getViewColumnAppearances(scope: HTMLElement): Record<string, unknown> {
		const config = getNativeViewConfig(this.app, scope);
		const store = config ? this.stores.get(config) : undefined;
		const record = store ? this.recordsByStore.get(store) : undefined;
		return { ...(record?.viewSnapshot.columnAppearances ?? {}) };
	}

	hasViewColumnAppearance(scope: HTMLElement, propertyId: string): boolean {
		return Object.prototype.hasOwnProperty.call(this.getViewColumnAppearances(scope), propertyId);
	}

	setViewColumnAppearance(scope: HTMLElement, propertyId: string, value: unknown): boolean {
		const store = this.forScope(scope);
		const record = this.recordsByStore.get(store);
		if (!record) return false;
		const baseline = structuredClone(record.viewSnapshot);
		const next = structuredClone(baseline);
		if (value === null) delete next.columnAppearances[propertyId];
		else next.columnAppearances[propertyId] = value;
		record.viewSnapshot = structuredClone(next);
		void this.syncView(record, next, baseline).then((persisted) => {
			record.viewSnapshot = structuredClone(persisted ?? baseline);
		});
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
		const stored = await this.readBaseData(scope);
		record.store.setDeclaredOptions(stored.declared, (identity, hex) => {
			void this.writeDeclaredColor(record.scope, identity, hex);
		});
		const group = record.group;
		const local = baseDataFromSettings(
			record.store.settings,
			record.baseSnapshot,
			this.globalStore.settings.paletteTemplateId,
		);
		const hydrated = mergeBaseChanges(
			record.baseSnapshot,
			local,
			stored.data ?? group.base ?? fallback,
		);
		if (stored.legacy) delete hydrated.rawSource;
		this.publishBase(group, hydrated, record);
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
				applyBaseToSettings(record.store.settings, data, this.globalStore.settings.paletteTemplateId);
				record.store.notify();
				continue;
			}
			const local = baseDataFromSettings(
				record.store.settings,
				record.baseSnapshot,
				this.globalStore.settings.paletteTemplateId,
			);
			const projected = mergeBaseChanges(record.baseSnapshot, local, data);
			record.baseSnapshot = structuredClone(data);
			applyBaseToSettings(record.store.settings, projected, this.globalStore.settings.paletteTemplateId);
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
			const persisted = await this.syncBaseViews(pending.scope, pending.data);
			if (persisted) this.publishBase(group, persisted);
		}
	}

	private async initializePropertyIdentity(
		scope: HTMLElement,
		_config: NativeViewConfig,
		_store: SettingsStore,
	): Promise<void> {
		const context = await this.propertyContext(scope);
		this.canonicalProperties.set(scope, context.aliases);
		_store.rekeyProperties(
			(propertyId) => resolveWithAliases(context.aliases, propertyId),
			false,
		);
	}

	private propertyContext(scope: HTMLElement): Promise<BasePropertyContext> {
		const existing = this.propertyContexts.get(scope);
		if (existing) return existing;
		const pending = loadBasePropertyContext(this.app, scope);
		this.propertyContexts.set(scope, pending);
		return pending;
	}

	private async readBaseData(scope: HTMLElement): Promise<{
		data: BaseVisualData | null;
		legacy: boolean;
		declared: Record<string, DeclaredOption[]>;
	}> {
		const none = { data: null, legacy: false, declared: {} };
		const file = getNativeBaseFile(this.app, scope);
		if (!file || !this.app.vault?.cachedRead) return none;
		try {
			const parsed = parseYaml(await this.app.vault.cachedRead(file)) as Record<string, unknown> | null;
			if (!parsed) return none;
			const declared = Object.fromEntries(
				Object.entries(declaredPropertyTypes(parsed)).map(([propertyId, type]) => [propertyId, type.options]),
			);
			const current = normalizeBaseData(parsed[BASE_VISUALS_KEY]);
			if (current) return { data: current, legacy: false, declared };
			if (Array.isArray(parsed.views)) {
				for (const candidate of parsed.views) {
					if (!isRecord(candidate)) continue;
					const data = normalizeBaseData(candidate[LEGACY_BASE_VISUALS_KEY]);
					if (data) return { data, legacy: true, declared };
				}
			}
			return { ...none, declared };
		} catch {
			return none;
		}
	}

	/** Saves a declared option's colour in the Base's `basesEditor` block, through the shared contract. */
	private async writeDeclaredColor(scope: HTMLElement, identity: OptionIdentity, hex: string | null): Promise<void> {
		const file = getNativeBaseFile(this.app, scope);
		if (!file || !this.app.vault?.process) return;
		try {
			let reason = '';
			await this.app.vault.process(file, (source) => {
				const result = setDeclaredOptionColor(source, identity.propertyId, identity.value, hex);
				if (result.status === 'read-only') reason = result.reason;
				return result.source;
			});
			if (reason) new Notice(`Bases Visuals did not save the colour of “${identity.value}”: ${reason}`);
		} catch (error) {
			new Notice(`Bases Visuals could not save ${file.path}: ${errorMessage(error)}`);
		}
	}

	/**
	 * Follows edits to open Bases made elsewhere (BaseStudio, sync, another window): each open view
	 * rebases its unsaved choices onto the file and reloads the declared options.
	 */
	watch(registerEvent: (eventRef: EventRef) => void): void {
		if (!this.app.vault?.on) return;
		registerEvent(this.app.vault.on('modify', (file) => {
			const group = this.groups.get(`file:${file.path}`);
			if (!group) return;
			for (const record of group.records) void this.hydrateOrMigrate(record.scope, record, group.base);
		}));
	}

	private async syncBaseViews(scope: HTMLElement, data: BaseVisualData): Promise<BaseVisualData | null> {
		const file = getNativeBaseFile(this.app, scope);
		if (!file || !this.app.vault?.process) return null;
		this.persistenceStates.set(scope, { status: 'pending' });
		try {
			let result: BlockWriteResult<BaseVisualData> | null = null;
			await this.app.vault.process(file, (source) => {
				result = writeBaseVisuals(source, data);
				return result.source;
			});
			return this.settle(scope, file.path, result, 'Reopen the Base and try again.');
		} catch (error) {
			const reason = errorMessage(error);
			this.persistenceStates.set(scope, { status: 'failed', reason });
			new Notice(`Bases Visuals could not save ${file.path}: ${reason}`);
			return null;
		}
	}
	/** Records how a write ended and tells the user when it did not save. */
	private settle<T>(
		scope: HTMLElement,
		path: string,
		result: BlockWriteResult<T> | null,
		conflictAdvice = '',
	): T | null {
		if (!result) return null;
		if (result.status === 'read-only') {
			this.persistenceStates.set(scope, { status: 'read-only', reason: result.reason });
			new Notice(`Bases Visuals did not save ${path}: ${result.reason}.`);
			return null;
		}
		if (result.status === 'conflict') {
			this.persistenceStates.set(scope, { status: 'conflict', paths: result.paths });
			new Notice(
				`Bases Visuals did not save ${path}: conflicting changes in ${result.paths.join(', ')}.${conflictAdvice ? ` ${conflictAdvice}` : ''}`,
			);
			return null;
		}
		this.persistenceStates.set(scope, { status: 'saved' });
		return result.persisted;
	}

	private async syncView(
		record: StoreRecord,
		data: ViewVisualData,
		baseline: ViewVisualData = record.viewSnapshot,
	): Promise<ViewVisualData | null> {
		const file = getNativeBaseFile(this.app, record.scope);
		if (!file || !this.app.vault?.process) {
			if (isNewerVisualSchema(record.config.get(VIEW_VISUALS_KEY), 'view')) {
				return this.settle(record.scope, 'this view', {
					status: 'read-only',
					source: '',
					reason: 'basesVisualsView was saved by a newer version',
				});
			}
			const compact = compactViewData(data, data.rawSource);
			record.config.set(VIEW_VISUALS_KEY, hasExtensionChoices(compact) ? compact : null);
			record.config.set(COLUMN_APPEARANCE_CONFIG_KEY, null);
			return normalizeViewData(compact);
		}
		this.persistenceStates.set(record.scope, { status: 'pending' });
		try {
			let result: BlockWriteResult<ViewVisualData> | null = null;
			await this.app.vault.process(file, (source) => {
				const parsed = safeParseRecord(source);
				if (!parsed) {
					result = { status: 'read-only', source, reason: 'the Base document is malformed' };
					return source;
				}
				const viewIndex = findViewIndex(parsed.views, record);
				if (viewIndex < 0) {
					result = { status: 'read-only', source, reason: 'the active native view could not be identified uniquely' };
					return source;
				}
				result = writeViewVisuals(source, viewIndex, baseline, data);
				return result.source;
			});
			return this.settle(record.scope, file.path, result);
		} catch (error) {
			const reason = errorMessage(error);
			this.persistenceStates.set(record.scope, { status: 'failed', reason });
			new Notice(`Bases Visuals could not save ${file.path}: ${reason}`);
			return null;
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
		paletteTemplateId: base.paletteTemplateId ?? global.paletteTemplateId,
		knownProperties: structuredClone(base.knownProperties),
		propertyStrategies: structuredClone(base.propertyStrategies),
		rules: [...structuredClone(base.rules), ...structuredClone(view.rules)],
		managerSearch: global.managerSearch,
		collapsedPropertyGroups: [...global.collapsedPropertyGroups],
		ruleManagerSearch: global.ruleManagerSearch,
		layoutPresets: [],
		lastColumnWidthPreset: global.lastColumnWidthPreset,
	};
}


function baseDataFromSettings(
	settings: BasesPillColorsSettings,
	current: unknown,
	globalPaletteTemplateId: BasesPillColorsSettings['paletteTemplateId'],
): BaseVisualData {
	const previous = normalizeBaseData(current);
	const options = Object.fromEntries(
		Object.entries(settings.options).filter(([, option]) => option.override !== undefined),
	);
	return {
		schemaVersion: BASE_VISUALS_SCHEMA_VERSION,
		...(settings.paletteTemplateId !== globalPaletteTemplateId
			? { paletteTemplateId: settings.paletteTemplateId }
			: {}),
		options: structuredClone(options),
		knownProperties: {},
		rules: settings.rules.filter((rule) => rule.scope === 'base').map((rule) => structuredClone(rule)),
		propertyStrategies: structuredClone(settings.propertyStrategies),
		...(previous?.columnAppearances ? { columnAppearances: structuredClone(previous.columnAppearances) } : {}),
		...(previous?.rawSource ? { rawSource: structuredClone(previous.rawSource) } : {}),
	};
}





function applyBaseToSettings(
	settings: BasesPillColorsSettings,
	base: BaseVisualData,
	globalPaletteTemplateId: BasesPillColorsSettings['paletteTemplateId'],
): void {
	const viewRules = settings.rules.filter((rule) => rule.scope === 'view');
	settings.paletteTemplateId = base.paletteTemplateId ?? globalPaletteTemplateId;
	const transientOptions = Object.fromEntries(
		Object.entries(settings.options).filter(([, option]) => option.override === undefined),
	);
	settings.options = { ...transientOptions, ...structuredClone(base.options) };
	settings.propertyStrategies = structuredClone(base.propertyStrategies);
	settings.rules = [...structuredClone(base.rules), ...viewRules];
}


function viewDataFromSettings(
	settings: BasesPillColorsSettings,
	current: ViewVisualData,
): ViewVisualData {
	return {
		schemaVersion: VIEW_VISUALS_SCHEMA_VERSION,
		rules: settings.rules.filter((rule) => rule.scope === 'view').map((rule) => structuredClone(rule)),
		columnAppearances: structuredClone(current.columnAppearances),
		...(current.rawSource ? { rawSource: structuredClone(current.rawSource) } : {}),
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
			const canonical = canonicalPropertyId(name);
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
				resolveWithAliases(aliases, canonicalPropertyId(propertyId))),
		);
		return { aliases, definedPropertyIds, listPropertyIds, nonListPropertyIds, referencedPropertyIds };
	} catch {
		return { aliases, definedPropertyIds, listPropertyIds, nonListPropertyIds, referencedPropertyIds: new Set() };
	}
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





















function safeParseRecord(source: string): Record<string, unknown> | null {
	const read = readYamlMap(source, []);
	return read.status === 'present' ? read.value : null;
}


function findViewIndex(views: unknown, record: StoreRecord): number {
	if (!Array.isArray(views)) return -1;
	const candidates = views as unknown[];
	const records = candidates.map((view, index) => ({ view, index }))
		.filter((entry): entry is { view: Record<string, unknown>; index: number } => isRecord(entry.view));
	const baseline = record.viewSnapshot.rawSource;
	if (baseline) {
		const byBlock = records.filter(({ view }) => equalValues(view[VIEW_VISUALS_KEY], baseline));
		if (byBlock.length === 1) return byBlock[0]?.index ?? -1;
	}
	const name = record.config.get('name');
	const type = record.config.get('type');
	const byNativeIdentity = records.filter(({ view }) =>
		(typeof name !== 'string' || view.name === name) &&
		(typeof type !== 'string' || view.type === type));
	if (byNativeIdentity.length === 1) return byNativeIdentity[0]?.index ?? -1;
	return records.length === 1 ? records[0]?.index ?? -1 : -1;
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : 'unknown error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

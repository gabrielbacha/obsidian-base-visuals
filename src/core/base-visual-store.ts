import { Notice, parseYaml, type App, type EventRef } from 'obsidian';
import {
	getNativeBaseFile,
	getNativePropertyDisplayName,
	getNativePropertyIds,
	getNativePropertyKind,
	getNativeViewConfig,
	nativeViewBlock,
	resolveNativePropertyId,
	type NativeViewConfig,
} from './native-table-view';
import { SettingsStore } from './settings-store';
import {
	canonicalPropertyId,
	compactStudioView,
	equalValues,
	isOptionType,
	LEGACY_BASE_VISUALS_KEY,
	LEGACY_ROOT_KEYS,
	LEGACY_VIEW_KEYS,
	mergeStudioBase,
	mergeStudioView,
	newerBlockReason,
	normalizeColumnAppearance,
	optionColorOverride,
	overrideOptionColor,
	pillsStrategy,
	readStudioBase,
	readStudioView,
	readYamlMap,
	storedColumnAppearance,
	storedRules,
	strategyPills,
	STUDIO_KEY,
	studioBaseAppearances,
	studioOptions,
	studioOverrides,
	studioPalette,
	studioRules,
	studioStrategies,
	studioViewAppearances,
	writeStudioBase,
	writeStudioView,
	type BlockWriteResult,
	type StudioBase,
	type StudioOption,
	type StudioProperty,
	type StudioView,
} from '@gabrielbacha/bases-contract';
import { DEFAULT_SETTINGS, type BasesPillColorsSettings } from './types';

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
	/** The Base's `basesStudio` block as this view last took it. */
	baseSnapshot: StudioBase;
	/** This view's `basesStudio` block as it was last read or saved. */
	viewSnapshot: StudioView;
}

/**
 * One change to the Base's block: the edits from `baseline` (the file's block that the change was
 * made on) to `data`.
 */
interface BaseChange {
	scope: HTMLElement;
	baseline: StudioBase;
	data: StudioBase;
}

interface BaseStoreGroup {
	/** The Base's block as the open views show it: the file's, with changes not saved yet. */
	base: StudioBase;
	/** The Base's block as last read from, or written to, the file. */
	fileBase: StudioBase;
	records: Set<StoreRecord>;
	/** Changes not written yet, in order. Each is merged onto the file as it is then. */
	pending: BaseChange[];
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

		// Until the file is read, the Base's block is what an old per-view copy held (if any).
		const fallback = readStudioBase({ views: [{ [LEGACY_BASE_VISUALS_KEY]: config.get(LEGACY_BASE_VISUALS_KEY) }] });
		const group = this.getOrCreateGroup(scope, config, fallback);
		const base = group.base;
		const view = nativeViewBlock(config);
		const settings = scopedSettings(this.globalStore.settings, base, view);
		let record!: StoreRecord;
		const store = new SettingsStore(settings, async (next) => {
			this.globalStore.setManagerSearch(next.managerSearch);
			this.globalStore.setRuleManagerSearch(next.ruleManagerSearch);
			this.globalStore.setCollapsedPropertyGroups(next.collapsedPropertyGroups);
			const baseline = group.fileBase;
			const localBase = baseFromSettings(next, record.baseSnapshot, this.globalStore.settings.paletteTemplateId);
			const nextBase = mergeStudioBase(record.baseSnapshot, localBase, group.base).block;
			const localView = viewFromSettings(next, record.viewSnapshot);
			const latestView = nativeViewBlock(record.config);
			const nextView = mergeStudioView(record.viewSnapshot, localView, latestView).block;
			const persistedView = await this.syncView(record, nextView);
			if (persistedView) record.viewSnapshot = structuredClone(persistedView);
			this.publishBase(group, nextBase, record);
			await this.queueBaseSync(group, { scope, baseline, data: nextBase });
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
		this.unsubscribers.set(store, store.subscribe((change) => this.globalStore.notify(change)));
		void this.hydrate(scope, record, fallback)
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

	/** Each column's style in every view: the `style` of each property in the Base's block. */
	getBaseColumnAppearances(scope: HTMLElement): Record<string, unknown> {
		const config = getNativeViewConfig(this.app, scope);
		const store = config ? this.stores.get(config) : undefined;
		const base = store
			? this.recordsByStore.get(store)?.group.base
			: readStudioBase({ views: [{ [LEGACY_BASE_VISUALS_KEY]: config?.get(LEGACY_BASE_VISUALS_KEY) }] });
		return studioBaseAppearances(base ?? {});
	}

	/** Saves a column's style for every view (`null` removes it). */
	setBaseColumnAppearance(scope: HTMLElement, propertyId: string, value: unknown): boolean {
		const config = getNativeViewConfig(this.app, scope);
		if (!config) return false;
		const store = this.forScope(scope);
		const record = this.recordsByStore.get(store);
		if (!record) return false;
		const baseline = record.group.fileBase;
		const base = structuredClone(record.group.base);
		const property: StudioProperty = { ...base.properties?.[propertyId] };
		const style = value === null ? null : storedColumnAppearance(normalizeColumnAppearance(value));
		if (style) property.style = style;
		else delete property.style;
		base.properties = { ...base.properties, [propertyId]: property };
		this.publishBase(record.group, base);
		void this.queueBaseSync(record.group, { scope, baseline, data: base });
		return true;
	}

	getViewColumnAppearances(scope: HTMLElement): Record<string, unknown> {
		const config = getNativeViewConfig(this.app, scope);
		const store = config ? this.stores.get(config) : undefined;
		const record = store ? this.recordsByStore.get(store) : undefined;
		return studioViewAppearances(record?.viewSnapshot ?? {});
	}

	hasViewColumnAppearance(scope: HTMLElement, propertyId: string): boolean {
		return Object.prototype.hasOwnProperty.call(this.getViewColumnAppearances(scope), propertyId);
	}

	/**
	 * Saves a column's style for this view only (`null` removes it). A default style is kept as an
	 * empty one: it turns the Base's style off in this view.
	 */
	setViewColumnAppearance(scope: HTMLElement, propertyId: string, value: unknown): boolean {
		const store = this.forScope(scope);
		const record = this.recordsByStore.get(store);
		if (!record) return false;
		const baseline = structuredClone(record.viewSnapshot);
		const next = structuredClone(baseline);
		const column = { ...next.columns?.[propertyId] };
		if (value === null) delete column.style;
		else column.style = storedColumnAppearance(normalizeColumnAppearance(value)) ?? {};
		next.columns = { ...next.columns, [propertyId]: column };
		record.viewSnapshot = compactStudioView(next);
		void this.syncView(record, record.viewSnapshot, baseline).then((persisted) => {
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

	/**
	 * Reads the Base's block from the file and rebases this view's unsaved choices onto it. Nothing
	 * is written: a Base with the older blocks is moved into `basesStudio` on its next edit.
	 */
	private async hydrate(
		scope: HTMLElement,
		record: StoreRecord,
		fallback: StudioBase,
	): Promise<void> {
		const stored = await this.readBaseData(scope);
		record.store.setDeclaredOptions(stored.declared);
		const group = record.group;
		if (stored.data) group.fileBase = structuredClone(stored.data);
		const local = baseFromSettings(
			record.store.settings,
			record.baseSnapshot,
			this.globalStore.settings.paletteTemplateId,
		);
		const hydrated = mergeStudioBase(record.baseSnapshot, local, stored.data ?? group.base ?? fallback).block;
		this.publishBase(group, hydrated, record);
	}

	private getOrCreateGroup(
		scope: HTMLElement,
		config: NativeViewConfig,
		initial: StudioBase,
	): BaseStoreGroup {
		const file = getNativeBaseFile(this.app, scope);
		const key: BaseGroupKey = file?.path ? `file:${file.path}` : config;
		const existing = this.groups.get(key);
		if (existing) return existing;
		const group: BaseStoreGroup = {
			base: structuredClone(initial),
			fileBase: structuredClone(initial),
			records: new Set(),
			pending: [],
			syncPromise: null,
		};
		this.groups.set(key, group);
		return group;
	}

	private publishBase(
		group: BaseStoreGroup,
		data: StudioBase,
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
			const local = baseFromSettings(
				record.store.settings,
				record.baseSnapshot,
				this.globalStore.settings.paletteTemplateId,
			);
			const projected = mergeStudioBase(record.baseSnapshot, local, data).block;
			record.baseSnapshot = structuredClone(data);
			applyBaseToSettings(record.store.settings, projected, this.globalStore.settings.paletteTemplateId);
			record.store.notify();
		}
		this.globalStore.notify();
	}

	private queueBaseSync(group: BaseStoreGroup, change: BaseChange): Promise<void> {
		group.pending.push({
			scope: change.scope,
			baseline: structuredClone(change.baseline),
			data: structuredClone(change.data),
		});
		if (!group.syncPromise) {
			group.syncPromise = this.drainBaseSync(group).finally(() => {
				group.syncPromise = null;
			});
		}
		return group.syncPromise;
	}

	private async drainBaseSync(group: BaseStoreGroup): Promise<void> {
		for (let change = group.pending.shift(); change; change = group.pending.shift()) {
			const persisted = await this.syncBase(change);
			if (!persisted) continue;
			group.fileBase = structuredClone(persisted);
			// The file now holds this change; changes still queued are shown on top of it.
			if (!group.pending.length) this.publishBase(group, persisted);
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

	/** The Base's block in the file, and the options its select columns declare (for their labels). */
	private async readBaseData(scope: HTMLElement): Promise<{
		data: StudioBase | null;
		declared: Record<string, StudioOption[]>;
	}> {
		const none = { data: null, declared: {} };
		const file = getNativeBaseFile(this.app, scope);
		if (!file || !this.app.vault?.cachedRead) return none;
		try {
			const parsed = parseYaml(await this.app.vault.cachedRead(file)) as Record<string, unknown> | null;
			if (!parsed) return none;
			// A file with no block in either form has nothing saved yet (the view's own copy stands).
			const saved = STUDIO_KEY in parsed || LEGACY_ROOT_KEYS.some((key) => key in parsed) ||
				(Array.isArray(parsed.views) && parsed.views.some((view) => isRecord(view) && LEGACY_BASE_VISUALS_KEY in view));
			const data = readStudioBase(parsed);
			const declared = Object.fromEntries(
				Object.entries(data.properties ?? {}).flatMap(([propertyId, property]) =>
					isRecord(property) && isOptionType(property.type) ? [[propertyId, studioOptions(property)]] : []),
			);
			return { data: saved ? data : null, declared };
		} catch {
			return none;
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
			for (const record of group.records) void this.hydrate(record.scope, record, group.base);
		}));
	}

	private async syncBase({ scope, baseline, data }: BaseChange): Promise<StudioBase | null> {
		const file = getNativeBaseFile(this.app, scope);
		if (!file || !this.app.vault?.process) return null;
		this.persistenceStates.set(scope, { status: 'pending' });
		try {
			let result: BlockWriteResult<StudioBase> | null = null;
			await this.app.vault.process(file, (source) => {
				result = writeStudioBase(source, baseline, data);
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
		data: StudioView,
		baseline: StudioView = record.viewSnapshot,
	): Promise<StudioView | null> {
		const file = getNativeBaseFile(this.app, record.scope);
		if (!file || !this.app.vault?.process) {
			// Without the file, the view's own config holds the block; the older keys go, unless one
			// was saved by a newer version.
			const configView: Record<string, unknown> = {};
			for (const key of [STUDIO_KEY, ...LEGACY_VIEW_KEYS]) configView[key] = record.config.get(key);
			const newer = newerBlockReason({ views: [configView] });
			if (newer) return this.settle(record.scope, 'this view', { status: 'read-only', source: '', reason: newer });
			const compact = compactStudioView(data);
			record.config.set(STUDIO_KEY, Object.keys(compact).length ? compact : null);
			for (const key of LEGACY_VIEW_KEYS) if (record.config.get(key) !== undefined) record.config.set(key, null);
			return compact;
		}
		this.persistenceStates.set(record.scope, { status: 'pending' });
		try {
			let result: BlockWriteResult<StudioView> | null = null;
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
				result = writeStudioView(source, viewIndex, baseline, data);
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
	base: StudioBase,
	view: StudioView,
): BasesPillColorsSettings {
	return {
		...structuredClone(DEFAULT_SETTINGS),
		options: studioOverrides(base),
		paletteTemplateId: studioPalette(base) ?? global.paletteTemplateId,
		knownProperties: {},
		propertyStrategies: studioStrategies(base),
		rules: [...studioRules(base, 'base'), ...studioRules(view, 'view')],
		managerSearch: global.managerSearch,
		collapsedPropertyGroups: [...global.collapsedPropertyGroups],
		ruleManagerSearch: global.ruleManagerSearch,
		layoutPresets: [],
		lastColumnWidthPreset: global.lastColumnWidthPreset,
	};
}

/**
 * The Base's block with the choices in `settings` written over `current`: the palette, each
 * value's colour (on the property's options), each property's pill strategy and the Base rules.
 * What the settings do not hold (types, labels, styles, unknown keys) stays as it is, and a choice
 * that did not change keeps its stored form.
 */
function baseFromSettings(
	settings: BasesPillColorsSettings,
	current: StudioBase,
	globalPaletteTemplateId: BasesPillColorsSettings['paletteTemplateId'],
): StudioBase {
	const block = structuredClone(current);
	if (settings.paletteTemplateId !== (studioPalette(current) ?? globalPaletteTemplateId)) {
		if (settings.paletteTemplateId === globalPaletteTemplateId) delete block.palette;
		else block.palette = settings.paletteTemplateId;
	}
	const colors = new Map<string, Map<string, string>>();
	for (const option of Object.values(settings.options)) {
		if (!option.override) continue;
		const property = colors.get(option.propertyId) ?? new Map<string, string>();
		property.set(option.value, overrideOptionColor(option.override));
		colors.set(option.propertyId, property);
	}
	const ids = new Set([
		...Object.keys(block.properties ?? {}),
		...colors.keys(),
		...Object.keys(settings.propertyStrategies),
	]);
	const properties: Record<string, StudioProperty> = {};
	for (const id of ids) {
		const record: StudioProperty = { ...block.properties?.[id] };
		const options = withColors(record, colors.get(id) ?? new Map());
		if (options.length) record.options = options;
		else delete record.options;
		const strategy = settings.propertyStrategies[id];
		if (!equalValues(pillsStrategy(record.pills), strategy)) {
			const unknown: Record<string, unknown> = { ...(isRecord(record.pills) ? record.pills : {}) };
			for (const key of ['mode', 'preset', 'style', 'wrap']) delete unknown[key];
			const pills = { ...unknown, ...strategyPills(strategy) };
			if (Object.keys(pills).length) record.pills = pills;
			else delete record.pills;
		}
		if (Object.keys(record).length) properties[id] = record;
	}
	block.properties = properties;
	const rules = settings.rules.filter((rule) => rule.scope === 'base');
	if (!equalValues(studioRules(current, 'base'), rules)) block.rules = storedRules(current.rules, rules);
	return block;
}

/**
 * A property's options with each value's colour from `colors` (value → preset, hex or `none`):
 * a colour on an option that has none is set, a colour gone is removed, and a coloured value with
 * no option is added. An option left with only its value is dropped unless the property's type
 * declares options.
 */
function withColors(record: StudioProperty, colors: ReadonlyMap<string, string>): StudioOption[] {
	const wanted = new Map(colors);
	const list: unknown[] = Array.isArray(record.options) ? record.options : [];
	const options = list.flatMap((item): StudioOption[] => {
		const value = typeof item === 'string' ? item : isRecord(item) ? item.value : undefined;
		if (typeof value !== 'string') return [item as StudioOption];
		const color = wanted.get(value);
		wanted.delete(value);
		const stored = isRecord(item) ? item.color : undefined;
		if (equalValues(optionColorOverride(stored), color === undefined ? undefined : optionColorOverride(color)))
			return [item as StudioOption];
		const option: Record<string, unknown> = isRecord(item) ? { ...item } : { value };
		if (color === undefined) delete option.color;
		else option.color = color;
		if (!isOptionType(record.type) && Object.keys(option).length === 1) return [];
		return [option as StudioOption];
	});
	for (const [value, color] of wanted) options.push({ value, color });
	return options;
}

function applyBaseToSettings(
	settings: BasesPillColorsSettings,
	base: StudioBase,
	globalPaletteTemplateId: BasesPillColorsSettings['paletteTemplateId'],
): void {
	const viewRules = settings.rules.filter((rule) => rule.scope === 'view');
	settings.paletteTemplateId = studioPalette(base) ?? globalPaletteTemplateId;
	const transientOptions = Object.fromEntries(
		Object.entries(settings.options).filter(([, option]) => option.override === undefined),
	);
	settings.options = { ...transientOptions, ...studioOverrides(base) };
	settings.propertyStrategies = studioStrategies(base);
	settings.rules = [...studioRules(base, 'base'), ...viewRules];
}

/** The view's block with the view rules in `settings` written over `current`. */
function viewFromSettings(settings: BasesPillColorsSettings, current: StudioView): StudioView {
	const block = structuredClone(current);
	const rules = settings.rules.filter((rule) => rule.scope === 'view');
	if (!equalValues(studioRules(current, 'view'), rules)) block.rules = storedRules(current.rules, rules);
	return block;
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
	const snapshot = record.viewSnapshot;
	if (typeof snapshot.id === 'string') {
		const byId = records.filter(({ view }) => readStudioView(view).id === snapshot.id);
		if (byId.length === 1) return byId[0]?.index ?? -1;
	}
	if (Object.keys(snapshot).length) {
		const byBlock = records.filter(({ view }) => equalValues(compactStudioView(readStudioView(view)), snapshot));
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

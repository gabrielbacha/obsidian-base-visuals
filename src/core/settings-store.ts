import {
	defaultRuleBackgroundOpacity,
	effectivePropertyStrategy,
	encodeOptionKey,
	inferPropertyStrategy,
	normalizePaletteTemplateId,
	normalizePropertyStrategies,
	normalizePropertyStrategy,
	normalizeRule,
	normalizeRuleOpacity,
	normalizeStoredOptions,
	optionColorOverride,
	pillColor,
	ROW_HEIGHTS,
	type StudioOption,
	type RowHeight,
	type ResolvedColor,
} from '@gabrielbacha/bases-contract';
import {
	BasesPillColorsSettings,
	LayoutPreset,
	ColorOverride,
	ConditionalRule,
	DEFAULT_SETTINGS,
	OptionIdentity,
	SCHEMA_VERSION,
	StoredOption,
	PropertyColorStrategy,
	PILL_STYLES,
	PillStyle,
	PaletteTemplateId,
} from './types';

type SaveSettings = (settings: BasesPillColorsSettings) => Promise<void>;
/**
 * What changed. `discovery` is a value or property seen for the first time: it changes no colour,
 * so views that only show colours can skip it (the managers still list the new entry).
 */
export type StoreChange = 'change' | 'discovery';
type Listener = (change: StoreChange) => void;

export class SettingsStore {
	private readonly listeners = new Set<Listener>();
	private declaredOptions: Readonly<Record<string, readonly StudioOption[]>> = {};
	private saveTimer: number | null = null;

	constructor(
		public readonly settings: BasesPillColorsSettings,
		private readonly saveSettings: SaveSettings,
	) {}

	static normalize(raw: unknown): BasesPillColorsSettings {
		if (!isRecord(raw)) return structuredClone(DEFAULT_SETTINGS);

		const options = normalizeStoredOptions(raw.options);

		const knownProperties: BasesPillColorsSettings['knownProperties'] = {};
		if (isRecord(raw.knownProperties)) {
			for (const candidate of Object.values(raw.knownProperties)) {
				if (!isRecord(candidate) || typeof candidate.propertyId !== 'string') continue;
				const propertyId = candidate.propertyId.trim();
				if (propertyId) knownProperties[propertyId] = { propertyId };
			}
		}
		for (const option of Object.values(options)) {
			knownProperties[option.propertyId] = { propertyId: option.propertyId };
		}

		const rules = Array.isArray(raw.rules)
			? raw.rules.flatMap((candidate, index) => {
				const rule = normalizeRule(candidate, index, {
					scope: isRecord(candidate) && candidate.scope === 'view' ? 'view' : 'base',
					// Rules saved before the opacity contract meant a 12% tint when they had no opacity.
					legacy: !(typeof raw.schemaVersion === 'number' && raw.schemaVersion >= SCHEMA_VERSION),
				});
				if (rule) knownProperties[rule.propertyId] = { propertyId: rule.propertyId };
				return rule ? [rule] : [];
			})
			: [];
		const layoutPresets = normalizeLayoutPresets(raw.layoutPresets);
		const lastColumnWidthPreset = normalizeColumnWidth(raw.lastColumnWidthPreset);
		const propertyStrategies = normalizePropertyStrategies(raw.propertyStrategies);
		for (const propertyId of Object.keys(propertyStrategies)) {
			knownProperties[propertyId] = { propertyId };
		}
		const collapsedPropertyGroups = normalizePropertyIds(raw.collapsedPropertyGroups);

		return {
			schemaVersion: SCHEMA_VERSION,
			paletteTemplateId: normalizePaletteTemplateId(raw.paletteTemplateId),
			options,
			managerSearch:
				typeof raw.managerSearch === 'string' ? raw.managerSearch : '',
			rules,
			knownProperties,
			propertyStrategies,
			collapsedPropertyGroups,
			ruleManagerSearch:
				typeof raw.ruleManagerSearch === 'string' ? raw.ruleManagerSearch : '',
			layoutPresets,
			lastColumnWidthPreset,
		};
	}

	/** Remove values learned while rendering; only deliberate choices are durable. */
	static compactForPersistence(settings: BasesPillColorsSettings): BasesPillColorsSettings {
		const compact = structuredClone(settings);
		compact.options = Object.fromEntries(
			Object.entries(compact.options).filter(([, option]) => option.override !== undefined),
		);
		const referencedProperties = new Set([
			...Object.values(compact.options).map((option) => option.propertyId),
			...compact.rules.map((rule) => rule.propertyId),
			...Object.keys(compact.propertyStrategies),
		]);
		compact.knownProperties = Object.fromEntries(
			[...referencedProperties].map((propertyId) => [propertyId, { propertyId }]),
		);
		return compact;
	}

	getPaletteTemplateId(): PaletteTemplateId {
		return this.settings.paletteTemplateId;
	}

	setPaletteTemplateId(id: PaletteTemplateId): void {
		const normalized = normalizePaletteTemplateId(id);
		if (this.settings.paletteTemplateId === normalized) return;
		this.settings.paletteTemplateId = normalized;
		this.changed();
	}

	get(identity: OptionIdentity): StoredOption | undefined {
		return this.settings.options[encodeOptionKey(identity)];
	}

	ensure(identity: OptionIdentity): StoredOption {
		const key = encodeOptionKey(identity);
		const existing = this.settings.options[key];
		if (existing) return existing;

		const option = { ...identity };
		this.settings.options[key] = option;
		this.emit('discovery');
		return option;
	}

	setOverride(identity: OptionIdentity, override?: ColorOverride): void {
		const option = this.ensure(identity);
		if (override) option.override = override;
		else delete option.override;
		this.scheduleSave();
		this.emit();
	}

	/**
	 * The options the Base declares for its select columns (their values and labels). A value's
	 * colour is one of the Base's option colours, like any other value's.
	 */
	setDeclaredOptions(declared: Readonly<Record<string, readonly StudioOption[]>>): void {
		this.declaredOptions = declared;
		this.emit();
	}

	getDeclaredOption(identity: OptionIdentity): StudioOption | undefined {
		return this.declaredOptions[identity.propertyId]?.find((option) => option.value === identity.value);
	}

	getDeclaredOptions(propertyId: string): readonly StudioOption[] {
		return this.declaredOptions[propertyId] ?? [];
	}

	/**
	 * The colour a value shows, decided by the shared contract: the value's own colour, then the
	 * colour the Base declares for that option, then the property's strategy.
	 */
	colorFor(identity: OptionIdentity, displayName?: string): ResolvedColor {
		const key = encodeOptionKey(identity);
		const declaredColor = this.settings.options[key]?.override
			? undefined
			: optionColorOverride(this.getDeclaredOption(identity)?.color);
		return pillColor(
			{
				paletteTemplateId: this.settings.paletteTemplateId,
				strategies: this.settings.propertyStrategies,
				// The contract reads only this value's entry, so a declared colour needs no copy of the rest.
				overrides: declaredColor
					? { [key]: { ...identity, override: declaredColor } }
					: this.settings.options,
				displayName: () => displayName,
			},
			identity.propertyId,
			identity.value,
		);
	}

	getExplicitPropertyStrategy(propertyId: string): PropertyColorStrategy | undefined {
		return this.settings.propertyStrategies[propertyId];
	}

	getPropertyStrategy(propertyId: string, displayName?: string): PropertyColorStrategy {
		return effectivePropertyStrategy(propertyId, displayName, this.getExplicitPropertyStrategy(propertyId));
	}

	getInferredPropertyStrategy(propertyId: string, displayName?: string): PropertyColorStrategy {
		return inferPropertyStrategy(propertyId, displayName);
	}

	getPropertyStyle(propertyId: string): PillStyle {
		return this.settings.propertyStrategies[propertyId]?.style ?? 'soft';
	}

	getWrapPills(propertyId: string): boolean {
		return this.settings.propertyStrategies[propertyId]?.wrapPills === true;
	}

	setPropertyStrategy(propertyId: string, strategy: PropertyColorStrategy | undefined): void {
		const currentStyle = this.getPropertyStyle(propertyId);
		const currentWrapPills = this.getWrapPills(propertyId);
		const normalized = normalizePropertyStrategy(strategy
			? {
				...strategy,
				...(strategy.style ? {} : { style: currentStyle }),
				...(strategy.wrapPills === undefined && currentWrapPills ? { wrapPills: true } : {}),
			}
			: currentStyle === 'soft' && !currentWrapPills
				? undefined
				: { mode: 'smart', style: currentStyle, ...(currentWrapPills ? { wrapPills: true } : {}) });
		if (!normalized || (normalized.mode === 'smart' && !normalized.style && !normalized.wrapPills)) delete this.settings.propertyStrategies[propertyId];
		else this.settings.propertyStrategies[propertyId] = normalized;
		this.discoverProperty(propertyId);
		this.changed();
	}

	setPropertyStyle(propertyId: string, style: PillStyle): void {
		const normalizedStyle = PILL_STYLES.includes(style) ? style : 'soft';
		const current = this.settings.propertyStrategies[propertyId] ?? { mode: 'smart' as const };
		const next: PropertyColorStrategy = {
			...current,
			...(normalizedStyle === 'soft' ? {} : { style: normalizedStyle }),
		};
		if (normalizedStyle === 'soft') delete next.style;
		if (next.mode === 'smart' && !next.style && !next.wrapPills) delete this.settings.propertyStrategies[propertyId];
		else this.settings.propertyStrategies[propertyId] = next;
		this.discoverProperty(propertyId);
		this.changed();
	}

	setWrapPills(propertyId: string, enabled: boolean): void {
		const current = this.settings.propertyStrategies[propertyId] ?? { mode: 'smart' as const };
		const next: PropertyColorStrategy = {
			...current,
			...(enabled ? { wrapPills: true } : {}),
		};
		if (!enabled) delete next.wrapPills;
		if (next.mode === 'smart' && !next.style && !next.wrapPills) delete this.settings.propertyStrategies[propertyId];
		else this.settings.propertyStrategies[propertyId] = next;
		this.discoverProperty(propertyId);
		this.changed();
	}

	resetProperty(propertyId: string): void {
		let changed = false;
		if (this.settings.propertyStrategies[propertyId]) {
			delete this.settings.propertyStrategies[propertyId];
			changed = true;
		}
		for (const option of Object.values(this.settings.options)) {
			if (option.propertyId === propertyId && option.override) {
				delete option.override;
				changed = true;
			}
		}
		if (changed) {
			this.scheduleSave();
			this.emit();
		}
	}

	resetAll(): void {
		this.resetProperties();
	}

	resetProperties(propertyIds?: ReadonlySet<string>): void {
		let changed = false;
		for (const propertyId of Object.keys(this.settings.propertyStrategies)) {
			if (propertyIds && !propertyIds.has(propertyId)) continue;
			delete this.settings.propertyStrategies[propertyId];
			changed = true;
		}
		for (const option of Object.values(this.settings.options)) {
			if ((!propertyIds || propertyIds.has(option.propertyId)) && option.override) {
				delete option.override;
				changed = true;
			}
		}
		if (changed) {
			this.scheduleSave();
			this.emit();
		}
	}

	removeUnusedOptions(identities: readonly OptionIdentity[], removedProperties: readonly string[]): number {
		let removed = 0;
		for (const identity of identities) {
			const key = encodeOptionKey(identity);
			if (!this.settings.options[key]) continue;
			delete this.settings.options[key];
			removed += 1;
		}
		for (const propertyId of removedProperties) {
			if (this.settings.propertyStrategies[propertyId]) {
				delete this.settings.propertyStrategies[propertyId];
				removed += 1;
			}
			const referencedByRule = this.settings.rules.some((rule) => rule.propertyId === propertyId);
			if (!referencedByRule) delete this.settings.knownProperties[propertyId];
		}
		if (removed > 0) this.changed();
		return removed;
	}

	rekeyProperties(resolve: (propertyId: string) => string, persist = true): boolean {
		let changed = false;
		const options: typeof this.settings.options = {};
		const orderedOptions = Object.values(this.settings.options).sort((first, second) =>
			Number(resolve(first.propertyId) !== first.propertyId) - Number(resolve(second.propertyId) !== second.propertyId));
		for (const option of orderedOptions) {
			const propertyId = resolve(option.propertyId);
			if (propertyId !== option.propertyId) changed = true;
			const next = { ...option, propertyId };
			const key = encodeOptionKey(next);
			const existing = options[key];
			options[key] = existing
				? { ...next, ...existing, override: existing.override ?? next.override }
				: next;
		}

		const knownProperties: typeof this.settings.knownProperties = {};
		for (const property of Object.values(this.settings.knownProperties)) {
			const propertyId = resolve(property.propertyId);
			if (propertyId !== property.propertyId) changed = true;
			knownProperties[propertyId] = { propertyId };
		}

		const propertyStrategies: typeof this.settings.propertyStrategies = {};
		const orderedStrategies = Object.entries(this.settings.propertyStrategies).sort(([first], [second]) =>
			Number(resolve(first) !== first) - Number(resolve(second) !== second));
		for (const [legacyId, strategy] of orderedStrategies) {
			const propertyId = resolve(legacyId);
			if (propertyId !== legacyId) changed = true;
			if (!propertyStrategies[propertyId] || propertyId === legacyId) {
				propertyStrategies[propertyId] = strategy;
			}
		}

		const rules = this.settings.rules.map((rule) => {
			const propertyId = resolve(rule.propertyId);
			if (propertyId !== rule.propertyId) changed = true;
			return propertyId === rule.propertyId ? rule : { ...rule, propertyId };
		});
		const collapsedPropertyGroups = normalizePropertyIds(
			this.settings.collapsedPropertyGroups.map((propertyId) => resolve(propertyId)),
		);
		if (!sameStrings(collapsedPropertyGroups, this.settings.collapsedPropertyGroups)) changed = true;
		if (!changed) return false;
		this.settings.options = options;
		this.settings.knownProperties = knownProperties;
		this.settings.propertyStrategies = propertyStrategies;
		this.settings.rules = rules;
		this.settings.collapsedPropertyGroups = collapsedPropertyGroups;
		if (persist) this.changed();
		else this.emit();
		return true;
	}

	setManagerSearch(search: string): void {
		if (this.settings.managerSearch === search) return;
		this.settings.managerSearch = search;
		this.scheduleSave();
	}

	isPropertyGroupCollapsed(propertyId: string): boolean {
		return this.settings.collapsedPropertyGroups.includes(propertyId);
	}

	setPropertyGroupCollapsed(propertyId: string, collapsed: boolean): void {
		const normalized = propertyId.trim();
		if (!normalized) return;
		const next = new Set(this.settings.collapsedPropertyGroups);
		if (collapsed) next.add(normalized);
		else next.delete(normalized);
		this.setCollapsedPropertyGroups([...next]);
	}

	setCollapsedPropertyGroups(propertyIds: readonly string[]): void {
		const normalized = normalizePropertyIds(propertyIds);
		if (sameStrings(normalized, this.settings.collapsedPropertyGroups)) return;
		this.settings.collapsedPropertyGroups = normalized;
		this.changed();
	}

	discoverProperty(propertyId: string): void {
		const normalized = propertyId.trim();
		if (!normalized || this.settings.knownProperties[normalized]) return;
		this.settings.knownProperties[normalized] = { propertyId: normalized };
		this.emit('discovery');
	}

	allKnownProperties(): string[] {
		return Object.keys(this.settings.knownProperties).sort((a, b) => a.localeCompare(b));
	}

	addRule(propertyId: string): ConditionalRule {
		const rule: ConditionalRule = {
			id: createRuleId(),
			name: 'New formatting rule',
			enabled: true,
			propertyId: propertyId.trim(),
			operator: 'equals',
			operand: '',
			target: 'cell',
			scope: 'view',
		};
		this.settings.rules.push(rule);
		this.discoverProperty(rule.propertyId);
		this.changed();
		return rule;
	}

	updateRule(id: string, patch: Partial<Omit<ConditionalRule, 'id'>>): void {
		const rule = this.settings.rules.find((candidate) => candidate.id === id);
		if (!rule) return;
		Object.assign(rule, patch);
		if ('color' in patch && patch.color === undefined) delete rule.color;
		if ('fontColor' in patch && patch.fontColor === undefined) delete rule.fontColor;
		if ('backgroundOpacity' in patch) {
			const opacity = normalizeRuleOpacity(patch.backgroundOpacity);
			if (opacity === undefined) delete rule.backgroundOpacity;
			else rule.backgroundOpacity = opacity;
		}
		if ('bold' in patch && !patch.bold) delete rule.bold;
		if ('strikethrough' in patch && !patch.strikethrough) delete rule.strikethrough;
		if ('overridePillColors' in patch && !patch.overridePillColors) delete rule.overridePillColors;
		if (!rule.color) {
			delete rule.backgroundOpacity;
			delete rule.overridePillColors;
		} else if (rule.backgroundOpacity === undefined) {
			// A saved background always carries its tint: without one, the shared contract means 100%.
			rule.backgroundOpacity = defaultRuleBackgroundOpacity(rule.color);
		}
		if (patch.propertyId) this.discoverProperty(patch.propertyId);
		this.changed();
	}

	duplicateRule(id: string): void {
		const index = this.settings.rules.findIndex((rule) => rule.id === id);
		if (index < 0) return;
		const source = this.settings.rules[index];
		if (!source) return;
		const copy = structuredClone(source);
		copy.id = createRuleId();
		copy.name = `${source.name} copy`;
		this.settings.rules.splice(index + 1, 0, copy);
		this.changed();
	}

	deleteRule(id: string): void {
		const index = this.settings.rules.findIndex((rule) => rule.id === id);
		if (index < 0) return;
		this.settings.rules.splice(index, 1);
		this.changed();
	}

	moveRule(id: string, direction: -1 | 1): void {
		const index = this.settings.rules.findIndex((rule) => rule.id === id);
		if (index < 0) return;
		this.moveRuleTo(id, index + direction);
	}

	moveRuleTo(id: string, targetIndex: number): void {
		const index = this.settings.rules.findIndex((rule) => rule.id === id);
		const target = Math.max(0, Math.min(this.settings.rules.length - 1, Math.trunc(targetIndex)));
		if (index < 0 || target === index) return;
		const [rule] = this.settings.rules.splice(index, 1);
		if (!rule) return;
		this.settings.rules.splice(target, 0, rule);
		this.changed();
	}

	setRuleManagerSearch(search: string): void {
		if (this.settings.ruleManagerSearch === search) return;
		this.settings.ruleManagerSearch = search;
		this.scheduleSave();
	}

	addLayoutPreset(
		name: string,
		rowHeight: LayoutPreset['rowHeight'],
		columnWidth: number,
		columnScope: LayoutPreset['columnScope'],
	): LayoutPreset | null {
		const normalizedName = name.trim().slice(0, 40);
		const normalizedWidth = normalizeColumnWidth(columnWidth);
		if (!normalizedName || normalizedWidth === null || !isStoredRowHeight(rowHeight) ||
			(columnScope !== 'unset' && columnScope !== 'all')) return null;
		const preset = {
			id: createLayoutPresetId(),
			name: normalizedName,
			rowHeight,
			columnWidth: normalizedWidth,
			columnScope,
		};
		this.settings.layoutPresets.push(preset);
		this.changed();
		return preset;
	}

	deleteLayoutPreset(id: string): void {
		const index = this.settings.layoutPresets.findIndex((preset) => preset.id === id);
		if (index < 0) return;
		this.settings.layoutPresets.splice(index, 1);
		this.changed();
	}

	setLastColumnWidthPreset(width: number | null): void {
		if (width === null) {
			if (this.settings.lastColumnWidthPreset === null) return;
			this.settings.lastColumnWidthPreset = null;
			this.scheduleSave();
			return;
		}
		const normalized = normalizeColumnWidth(width);
		if (normalized === null || this.settings.lastColumnWidthPreset === normalized) return;
		this.settings.lastColumnWidthPreset = normalized;
		this.scheduleSave();
	}

	allOptions(): StoredOption[] {
		return Object.values(this.settings.options);
	}

	hasOverrides(propertyIds?: ReadonlySet<string>): boolean {
		return this.allOptions().some((option) =>
			(!propertyIds || propertyIds.has(option.propertyId)) && option.override !== undefined) ||
			Object.keys(this.settings.propertyStrategies).some((propertyId) =>
				!propertyIds || propertyIds.has(propertyId));
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async flush(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.saveSettings(this.settings);
	}

	notify(change: StoreChange = 'change'): void {
		this.emit(change);
	}

	dispose(): void {
		this.listeners.clear();
		void this.flush();
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveSettings(this.settings);
		}, 250);
	}

	private emit(change: StoreChange = 'change'): void {
		for (const listener of this.listeners) listener(change);
	}

	private changed(): void {
		this.scheduleSave();
		this.emit();
	}
}

let fallbackRuleId = 0;
let fallbackLayoutPresetId = 0;

function createRuleId(): string {
	return window.crypto?.randomUUID?.() ?? `rule-${Date.now()}-${fallbackRuleId += 1}`;
}

function createLayoutPresetId(): string {
	return window.crypto?.randomUUID?.() ??
		`layout-preset-${Date.now()}-${fallbackLayoutPresetId += 1}`;
}

function normalizeLayoutPresets(value: unknown): LayoutPreset[] {
	if (!Array.isArray(value)) return [];
	const presets: LayoutPreset[] = [];
	const ids = new Set<string>();
	for (const [index, candidate] of value.entries()) {
		if (!isRecord(candidate) || typeof candidate.name !== 'string') continue;
		const name = candidate.name.trim().slice(0, 40);
		const columnWidth = normalizeColumnWidth(candidate.columnWidth);
		if (!name || columnWidth === null || !isStoredRowHeight(candidate.rowHeight) ||
			(candidate.columnScope !== 'unset' && candidate.columnScope !== 'all')) continue;
		const requestedId = typeof candidate.id === 'string' ? candidate.id.trim() : '';
		const id = requestedId && !ids.has(requestedId) ? requestedId : `migrated-layout-${index}`;
		if (ids.has(id)) continue;
		ids.add(id);
		presets.push({
			id,
			name,
			rowHeight: candidate.rowHeight,
			columnWidth,
			columnScope: candidate.columnScope,
		});
	}
	return presets;
}

function normalizePropertyIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.flatMap((candidate) => {
		if (typeof candidate !== 'string') return [];
		const propertyId = candidate.trim();
		return propertyId ? [propertyId] : [];
	}))].sort((first, second) => first.localeCompare(second));
}

function sameStrings(first: readonly string[], second: readonly string[]): boolean {
	return first.length === second.length && first.every((value, index) => value === second[index]);
}

function isStoredRowHeight(value: unknown): value is LayoutPreset['rowHeight'] {
	return value === '' || (value !== 'short' && ROW_HEIGHTS.includes(value as RowHeight));
}

function normalizeColumnWidth(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return Math.round(Math.min(300, Math.max(40, value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

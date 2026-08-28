import { encodeOptionKey, normalizeHex, normalizePresetName } from './colors';
import { effectivePropertyStrategy, inferPropertyStrategy } from './property-strategies';
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
	PROPERTY_STRATEGY_MODES,
	PALETTE_NAMES,
} from './types';
import { isRuleOperator, normalizeRuleColor } from './rules';

type SaveSettings = (settings: BasesPillColorsSettings) => Promise<void>;
type Listener = () => void;

export class SettingsStore {
	private readonly listeners = new Set<Listener>();
	private saveTimer: number | null = null;

	constructor(
		public readonly settings: BasesPillColorsSettings,
		private readonly saveSettings: SaveSettings,
	) {}

	static normalize(raw: unknown): BasesPillColorsSettings {
		if (!isRecord(raw)) return structuredClone(DEFAULT_SETTINGS);

		const options: Record<string, StoredOption> = {};
		const rawOptions = isRecord(raw.options) ? raw.options : {};
		for (const candidate of Object.values(rawOptions)) {
			if (!isRecord(candidate)) continue;
			if (typeof candidate.propertyId !== 'string') continue;
			if (typeof candidate.value !== 'string') continue;
			const propertyId = candidate.propertyId.trim();
			const value = candidate.value.trim();
			if (!propertyId || !value) continue;

			const option: StoredOption = { propertyId, value };
			const override = normalizeOverride(candidate.override);
			if (override) option.override = override;
			options[encodeOptionKey(option)] = option;
		}

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
				const rule = normalizeRule(candidate, index);
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

		return {
			schemaVersion: SCHEMA_VERSION,
			options,
			managerSearch:
				typeof raw.managerSearch === 'string' ? raw.managerSearch : '',
			rules,
			knownProperties,
			propertyStrategies,
			ruleManagerSearch:
				typeof raw.ruleManagerSearch === 'string' ? raw.ruleManagerSearch : '',
			layoutPresets,
			lastColumnWidthPreset,
		};
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
		this.scheduleSave();
		this.emit();
		return option;
	}

	setOverride(identity: OptionIdentity, override?: ColorOverride): void {
		const option = this.ensure(identity);
		if (override) option.override = override;
		else delete option.override;
		this.scheduleSave();
		this.emit();
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

	setPropertyStrategy(propertyId: string, strategy: PropertyColorStrategy | undefined): void {
		const normalized = normalizePropertyStrategy(strategy);
		if (!normalized || normalized.mode === 'smart') delete this.settings.propertyStrategies[propertyId];
		else this.settings.propertyStrategies[propertyId] = normalized;
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
		let changed = false;
		if (Object.keys(this.settings.propertyStrategies).length > 0) {
			this.settings.propertyStrategies = {};
			changed = true;
		}
		for (const option of Object.values(this.settings.options)) {
			if (option.override) {
				delete option.override;
				changed = true;
			}
		}
		if (changed) {
			this.scheduleSave();
			this.emit();
		}
	}

	setManagerSearch(search: string): void {
		if (this.settings.managerSearch === search) return;
		this.settings.managerSearch = search;
		this.scheduleSave();
	}

	discoverProperty(propertyId: string): void {
		const normalized = propertyId.trim();
		if (!normalized || this.settings.knownProperties[normalized]) return;
		this.settings.knownProperties[normalized] = { propertyId: normalized };
		this.scheduleSave();
		this.emit();
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
			color: { kind: 'preset', name: 'sun-flower' },
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
		const target = index + direction;
		if (index < 0 || target < 0 || target >= this.settings.rules.length) return;
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

	hasOverrides(): boolean {
		return this.allOptions().some((option) => option.override !== undefined) ||
			Object.keys(this.settings.propertyStrategies).length > 0;
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

	notify(): void {
		this.emit();
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

	private emit(): void {
		for (const listener of this.listeners) listener();
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

function isStoredRowHeight(value: unknown): value is LayoutPreset['rowHeight'] {
	return value === '' || value === 'medium' || value === 'tall' || value === 'extra';
}

function normalizeColumnWidth(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return Math.round(Math.min(300, Math.max(40, value)));
}

function normalizeRule(value: unknown, index: number): ConditionalRule | null {
	if (!isRecord(value)) return null;
	if (typeof value.propertyId !== 'string' || !value.propertyId.trim()) return null;
	if (!isRuleOperator(value.operator)) return null;
	if (value.target !== 'cell' && value.target !== 'row') return null;
	const color = normalizeRuleColor(value.color);
	if (!color) return null;
	return {
		id: typeof value.id === 'string' && value.id.trim() ? value.id : `migrated-rule-${index}`,
		name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Formatting rule',
		enabled: value.enabled !== false,
		propertyId: value.propertyId.trim(),
		operator: value.operator,
		...(typeof value.operand === 'string' ? { operand: value.operand } : {}),
		target: value.target,
		scope: value.scope === 'view' ? 'view' : 'base',
		color,
	};
}

function normalizeOverride(value: unknown): ColorOverride | undefined {
	if (!isRecord(value) || typeof value.kind !== 'string') return undefined;
	if (value.kind === 'disabled') return { kind: 'disabled' };
	if (value.kind === 'preset') {
		const name = normalizePresetName(value.name);
		if (name) return { kind: 'preset', name };
	}
	if (value.kind === 'custom' && typeof value.hex === 'string') {
		const hex = normalizeHex(value.hex);
		if (hex) return { kind: 'custom', hex };
	}
	return undefined;
}

function normalizePropertyStrategies(value: unknown): Record<string, PropertyColorStrategy> {
	if (!isRecord(value)) return {};
	const strategies: Record<string, PropertyColorStrategy> = {};
	for (const [rawPropertyId, candidate] of Object.entries(value)) {
		const propertyId = rawPropertyId.trim();
		const strategy = normalizePropertyStrategy(candidate);
		if (propertyId && strategy && strategy.mode !== 'smart') strategies[propertyId] = strategy;
	}
	return strategies;
}

function normalizePropertyStrategy(value: unknown): PropertyColorStrategy | undefined {
	if (!isRecord(value) || !PROPERTY_STRATEGY_MODES.includes(value.mode as never)) return undefined;
	if (value.mode === 'single') {
		const preset = normalizePresetName(value.preset);
		return { mode: 'single', preset: preset && preset !== 'default' && PALETTE_NAMES.includes(preset) ? preset : 'peter-river' };
	}
	return { mode: value.mode as PropertyColorStrategy['mode'] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

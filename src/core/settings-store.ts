import { encodeOptionKey, isPresetName, normalizeHex } from './colors';
import {
	BasesPillColorsSettings,
	ColorOverride,
	ConditionalRule,
	DEFAULT_SETTINGS,
	OptionIdentity,
	SCHEMA_VERSION,
	StoredOption,
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

		return {
			schemaVersion: SCHEMA_VERSION,
			options,
			managerSearch:
				typeof raw.managerSearch === 'string' ? raw.managerSearch : '',
			rules,
			knownProperties,
			ruleManagerSearch:
				typeof raw.ruleManagerSearch === 'string' ? raw.ruleManagerSearch : '',
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

	resetProperty(propertyId: string): void {
		let changed = false;
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
			color: { kind: 'preset', name: 'yellow' },
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

	allOptions(): StoredOption[] {
		return Object.values(this.settings.options);
	}

	hasOverrides(): boolean {
		return this.allOptions().some((option) => option.override !== undefined);
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

function createRuleId(): string {
	return window.crypto?.randomUUID?.() ?? `rule-${Date.now()}-${fallbackRuleId += 1}`;
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
		color,
	};
}

function normalizeOverride(value: unknown): ColorOverride | undefined {
	if (!isRecord(value) || typeof value.kind !== 'string') return undefined;
	if (value.kind === 'disabled') return { kind: 'disabled' };
	if (value.kind === 'preset' && isPresetName(value.name)) {
		return { kind: 'preset', name: value.name };
	}
	if (value.kind === 'custom' && typeof value.hex === 'string') {
		const hex = normalizeHex(value.hex);
		if (hex) return { kind: 'custom', hex };
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

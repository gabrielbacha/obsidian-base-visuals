export const SCHEMA_VERSION = 5;

export const PALETTE_NAMES = [
	'green-sea',
	'peter-river',
	'wisteria',
	'midnight-blue',
	'raspberry',
	'sun-flower',
	'carrot',
	'pomegranate',
	'chestnut',
] as const;

/** Preset IDs retained only so colors saved by older versions still render. */
export const PRESET_NAMES = PALETTE_NAMES;
export const LEGACY_PRESET_NAMES = [
	'default', 'gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink',
] as const;

export const AUTO_PRESET_NAMES = PALETTE_NAMES;

export type PaletteName = (typeof PALETTE_NAMES)[number];
export type PresetName = PaletteName | 'default';

export const PROPERTY_STRATEGY_MODES = [
	'smart', 'distinct', 'status', 'priority', 'single', 'neutral', 'off',
] as const;
export type PropertyStrategyMode = (typeof PROPERTY_STRATEGY_MODES)[number];
export interface PropertyColorStrategy {
	mode: PropertyStrategyMode;
	preset?: PaletteName;
}

export type ColorOverride =
	| { kind: 'preset'; name: PresetName }
	| { kind: 'custom'; hex: string }
	| { kind: 'disabled' };

export interface OptionIdentity {
	propertyId: string;
	value: string;
}

export interface StoredOption extends OptionIdentity {
	override?: ColorOverride;
}

export const RULE_OPERATORS = [
	'equals',
	'not-equals',
	'contains',
	'not-contains',
	'is-empty',
	'is-not-empty',
	'greater-than',
	'greater-or-equal',
	'less-than',
	'less-or-equal',
] as const;

export type RuleOperator = (typeof RULE_OPERATORS)[number];
export type RuleTarget = 'cell' | 'row';
export type RuleScope = 'view' | 'base';
export type RuleColor =
	| { kind: 'preset'; name: PresetName }
	| { kind: 'custom'; hex: string };

export interface ConditionalRule {
	id: string;
	name: string;
	enabled: boolean;
	propertyId: string;
	operator: RuleOperator;
	operand?: string;
	target: RuleTarget;
	scope?: RuleScope;
	color: RuleColor;
}

export interface KnownProperty {
	propertyId: string;
}

export type StoredRowHeight = '' | 'medium' | 'tall' | 'extra';
export type StoredColumnWidthScope = 'unset' | 'all';

export interface LayoutPreset {
	id: string;
	name: string;
	rowHeight: StoredRowHeight;
	columnWidth: number;
	columnScope: StoredColumnWidthScope;
}

export interface BasesPillColorsSettings {
	schemaVersion: number;
	options: Record<string, StoredOption>;
	managerSearch: string;
	rules: ConditionalRule[];
	knownProperties: Record<string, KnownProperty>;
	propertyStrategies: Record<string, PropertyColorStrategy>;
	ruleManagerSearch: string;
	layoutPresets: LayoutPreset[];
	lastColumnWidthPreset: number | null;
}

export const DEFAULT_SETTINGS: BasesPillColorsSettings = {
	schemaVersion: SCHEMA_VERSION,
	options: {},
	managerSearch: '',
	rules: [],
	knownProperties: {},
	propertyStrategies: {},
	ruleManagerSearch: '',
	layoutPresets: [],
	lastColumnWidthPreset: null,
};

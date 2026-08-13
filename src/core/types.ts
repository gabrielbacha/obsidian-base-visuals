export const SCHEMA_VERSION = 3;

export const PRESET_NAMES = [
	'default',
	'gray',
	'brown',
	'red',
	'orange',
	'yellow',
	'green',
	'blue',
	'purple',
	'pink',
] as const;

export const AUTO_PRESET_NAMES = PRESET_NAMES.filter(
	(name): name is Exclude<PresetName, 'default'> => name !== 'default',
);

export type PresetName = (typeof PRESET_NAMES)[number];

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
	ruleManagerSearch: '',
	layoutPresets: [],
	lastColumnWidthPreset: null,
};

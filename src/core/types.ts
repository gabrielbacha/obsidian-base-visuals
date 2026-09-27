/** Version of the plugin settings in data.json. 11: rules follow the shared opacity contract. */
export const SCHEMA_VERSION = 11;

/** The data saved in `.base` files is defined once, in the shared contract. */
export {
	AUTO_PRESET_NAMES,
	LEGACY_PRESET_NAMES,
	PALETTE_NAMES,
	PALETTE_TEMPLATE_IDS,
	PILL_STYLES,
	PRESET_NAMES,
	PROPERTY_STRATEGY_MODES,
	RULE_OPERATORS,
	TEMPLATE_SLOT_NAMES,
	type ColorOverride,
	type ConditionalRule,
	type OptionIdentity,
	type PaletteName,
	type PalettePresetName,
	type PaletteTemplateId,
	type PillStyle,
	type PresetName,
	type PropertyColorStrategy,
	type PropertyStrategyMode,
	type RuleColor,
	type RuleOperator,
	type RuleScope,
	type RuleTarget,
	type StoredOption,
	type TemplateSlotName,
} from '@gabrielbacha/bases-contract';
import type {
	ConditionalRule,
	PaletteTemplateId,
	PropertyColorStrategy,
	RowHeight,
	StoredOption,
} from '@gabrielbacha/bases-contract';

export interface KnownProperty {
	propertyId: string;
}

/** A row height as a layout preset stores it: short, the native default, is ''. */
export type StoredRowHeight = '' | Exclude<RowHeight, 'short'>;
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
	paletteTemplateId: PaletteTemplateId;
	options: Record<string, StoredOption>;
	managerSearch: string;
	rules: ConditionalRule[];
	knownProperties: Record<string, KnownProperty>;
	propertyStrategies: Record<string, PropertyColorStrategy>;
	collapsedPropertyGroups: string[];
	ruleManagerSearch: string;
	layoutPresets: LayoutPreset[];
	lastColumnWidthPreset: number | null;
}

export const DEFAULT_SETTINGS: BasesPillColorsSettings = {
	schemaVersion: SCHEMA_VERSION,
	paletteTemplateId: 'default',
	options: {},
	managerSearch: '',
	rules: [],
	knownProperties: {},
	propertyStrategies: {},
	collapsedPropertyGroups: [],
	ruleManagerSearch: '',
	layoutPresets: [],
	lastColumnWidthPreset: null,
};

import { strategyColor } from './property-strategies';
import { leadingOrderNumber } from './value-order';
import {
	AUTO_PRESET_NAMES,
	PALETTE_NAMES,
	PALETTE_TEMPLATE_IDS,
	TEMPLATE_SLOT_NAMES,
	type ColorOverride,
	type OptionIdentity,
	type PaletteName,
	type PalettePresetName,
	type PaletteTemplateId,
	type PresetName,
	type PropertyColorStrategy,
	type TemplateSlotName,
} from './types';

export interface ResolvedColor {
	kind: 'auto' | 'preset' | 'custom' | 'neutral' | 'disabled';
	label: string;
	background: string;
	hoverBackground: string;
	foregroundLight: string;
	foregroundDark: string;
	border: string;
	dot: string;
	solidBackground: string;
	solidForeground: string;
	solidHoverBackground: string;
}
interface Rgb { r: number; g: number; b: number }

export const PALETTE: ReadonlyArray<{ name: PaletteName; label: string; hex: string }> = [
	{ name: 'green-sea', label: 'Green Sea', hex: '#16A085' },
	{ name: 'peter-river', label: 'Peter River', hex: '#3498DB' },
	{ name: 'wisteria', label: 'Wisteria', hex: '#8E44AD' },
	{ name: 'midnight-blue', label: 'Midnight Blue', hex: '#2C3E50' },
	{ name: 'raspberry', label: 'Raspberry', hex: '#D33682' },
	{ name: 'sun-flower', label: 'Sun Flower', hex: '#F1C40F' },
	{ name: 'carrot', label: 'Carrot', hex: '#E67E22' },
	{ name: 'pomegranate', label: 'Pomegranate', hex: '#C0392B' },
	{ name: 'chestnut', label: 'Chestnut', hex: '#8B5A2B' },
];
export interface PaletteTemplate {
	id: PaletteTemplateId;
	label: string;
	description: string;
	colors: ReadonlyArray<{ name: TemplateSlotName; label: string; hex: string }>;
	semanticIndexes: Readonly<Record<PaletteName, number>>;
}

const semanticIndexes = (...indexes: number[]): Readonly<Record<PaletteName, number>> =>
	Object.fromEntries(PALETTE_NAMES.map((name, index) => [name, indexes[index] ?? 0])) as Record<PaletteName, number>;

function createTemplate(
	id: PaletteTemplateId,
	label: string,
	description: string,
	hexes: readonly string[],
	indexes: Readonly<Record<PaletteName, number>>,
): PaletteTemplate {
	return {
		id,
		label,
		description,
		colors: hexes.map((hex, index) => ({
			name: TEMPLATE_SLOT_NAMES[index] ?? 'slot-10',
			label: id === 'default' ? PALETTE[index]?.label ?? `Color ${index + 1}` : `Color ${index + 1}`,
			hex,
		})),
		semanticIndexes: indexes,
	};
}

/** Exact source palettes plus semantic role mappings for Status, Priority, and Single color strategies. */
export const PALETTE_TEMPLATES: ReadonlyArray<PaletteTemplate> = [
	createTemplate('default', 'Default · Bases Visuals', 'Your Green Sea, Peter River and warm accent palette.', PALETTE.map((entry) => entry.hex), semanticIndexes(0, 1, 2, 3, 4, 5, 6, 7, 8)),
	createTemplate('sunset-spectrum', 'Sunset spectrum', 'Warm reds and oranges balanced by fresh greens and cool blues.', ['#F94144', '#F3722C', '#F8961E', '#F9844A', '#F9C74F', '#90BE6D', '#43AA8B', '#4D908E', '#577590', '#277DA1'], semanticIndexes(6, 9, 7, 8, 3, 4, 2, 0, 1)),
	createTemplate('desert-coast', 'Desert coast', 'Deep coastal teals flowing into sand, ochre, and terracotta.', ['#001219', '#005F73', '#0A9396', '#94D2BD', '#E9D8A6', '#EE9B00', '#CA6702', '#BB3E03', '#AE2012', '#9B2226'], semanticIndexes(2, 1, 3, 0, 9, 5, 6, 8, 7)),
	createTemplate('editorial', 'Editorial', 'A concise editorial set of blue, green, orange, cream, and neutral ink.', ['#003C71', '#3A8F5B', '#E24E1B', '#FCBF49', '#EAE2B7', '#F5F5F5', '#898989', '#3A3A3A'], semanticIndexes(1, 0, 6, 7, 2, 3, 2, 2, 6)),
	createTemplate('ocean-depth', 'Ocean depth', 'A monochromatic progression from deep navy to pale arctic blue.', ['#03045E', '#023E8A', '#0077B6', '#0096C7', '#00B4D8', '#48CAE4', '#90E0EF', '#ADE8F4', '#CAF0F8'], semanticIndexes(4, 2, 1, 0, 3, 6, 5, 0, 7)),
	createTemplate('ember', 'Ember', 'Near-black plum through crimson, flame orange, and molten gold.', ['#03071E', '#370617', '#6A040F', '#9D0208', '#D00000', '#DC2F02', '#E85D04', '#F48C06', '#FAA307', '#FFBA08'], semanticIndexes(8, 0, 1, 0, 3, 9, 7, 4, 2)),
	createTemplate('citrus-grove', 'Citrus grove', 'Evergreen and leaf tones brightening into electric citrus yellow.', ['#007F5F', '#2B9348', '#55A630', '#80B918', '#AACC00', '#BFD200', '#D4D700', '#DDDF00', '#EEEF20', '#FFFF3F'], semanticIndexes(0, 1, 2, 0, 3, 9, 7, 4, 5)),
	createTemplate('electric-bloom', 'Electric bloom', 'Hot pink and violet shifting through indigo into luminous cyan.', ['#F72585', '#B5179E', '#7209B7', '#560BAD', '#480CA8', '#3A0CA3', '#3F37C9', '#4361EE', '#4895EF', '#4CC9F0'], semanticIndexes(9, 8, 2, 4, 0, 9, 1, 0, 3)),
];
const PALETTE_BY_NAME = new Map(PALETTE.map((entry) => [entry.name, entry]));
const PALETTE_TEMPLATES_BY_ID = new Map(PALETTE_TEMPLATES.map((template) => [template.id, template]));
const LEGACY_PRESET_MAP: Record<string, PresetName> = {
	default: 'default', gray: 'midnight-blue', brown: 'chestnut', red: 'pomegranate', orange: 'carrot',
	yellow: 'sun-flower', green: 'green-sea', blue: 'peter-river', purple: 'wisteria', pink: 'raspberry',
};

export function encodeOptionKey(identity: OptionIdentity): string {
	return `${encodeURIComponent(identity.propertyId)}::${encodeURIComponent(identity.value)}`;
}
export function normalizeHex(input: string): string | null {
	const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(input.trim());
	if (!match?.[1]) return null;
	const raw = match[1].toUpperCase();
	return raw.length === 3 ? `#${raw.split('').map((character) => character.repeat(2)).join('')}` : `#${raw}`;
}
export function normalizePresetName(value: unknown): PresetName | null {
	if (typeof value !== 'string') return null;
	if (value === 'default') return 'default';
	if (TEMPLATE_SLOT_NAMES.includes(value as TemplateSlotName)) return value as TemplateSlotName;
	if (PALETTE_BY_NAME.has(value as PaletteName)) return value as PaletteName;
	return LEGACY_PRESET_MAP[value] ?? null;
}
export function isPresetName(value: unknown): value is PresetName { return normalizePresetName(value) !== null; }

export function normalizePaletteTemplateId(value: unknown): PaletteTemplateId {
	const legacy: Record<string, PaletteTemplateId> = {
		ocean: 'ocean-depth', nordic: 'default', material: 'editorial', slate: 'editorial',
	};
	return typeof value === 'string' && PALETTE_TEMPLATE_IDS.includes(value as PaletteTemplateId)
		? value as PaletteTemplateId
		: typeof value === 'string' ? legacy[value] ?? 'default' : 'default';
}

export function paletteTemplate(id: PaletteTemplateId = 'default'): PaletteTemplate {
	return PALETTE_TEMPLATES_BY_ID.get(normalizePaletteTemplateId(id)) ?? PALETTE_TEMPLATES[0]!;
}

export function palettePresetName(paletteId: PaletteTemplateId, index: number): PalettePresetName {
	if (paletteId === 'default') return PALETTE_NAMES[index] ?? 'peter-river';
	return TEMPLATE_SLOT_NAMES[index] ?? 'slot-10';
}

export function automaticPreset(identity: OptionIdentity): PaletteName {
	const order = leadingOrderNumber(identity.value);
	if (order !== null) {
		return AUTO_PRESET_NAMES[(order - 1) % AUTO_PRESET_NAMES.length] ?? 'peter-river';
	}
	const key = `${identity.propertyId}\u0000${identity.value}`;
	let hash = 2166136261;
	for (let index = 0; index < key.length; index += 1) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return AUTO_PRESET_NAMES[(hash >>> 0) % AUTO_PRESET_NAMES.length] ?? 'peter-river';
}

function automaticTemplateColor(identity: OptionIdentity, paletteId: PaletteTemplateId): PaletteTemplate['colors'][number] {
	const colors = paletteTemplate(paletteId).colors;
	const order = leadingOrderNumber(identity.value);
	if (order !== null) return colors[(order - 1) % colors.length] ?? colors[0]!;
	const key = `${identity.propertyId}\u0000${identity.value}`;
	let hash = 2166136261;
	for (let index = 0; index < key.length; index += 1) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return colors[(hash >>> 0) % colors.length] ?? colors[0]!;
}

export function resolveColor(identity: OptionIdentity, override?: ColorOverride, strategy: PropertyColorStrategy = { mode: 'distinct' }, paletteId: PaletteTemplateId = 'default'): ResolvedColor {
	if (override?.kind === 'disabled') return disabledColor();
	if (override?.kind === 'custom') {
		const normalized = normalizeHex(override.hex);
		if (normalized) return filledColor(normalized, normalized, 'custom');
	}
	if (override?.kind === 'preset') {
		if (override.name === 'default') return neutralColor('Default');
		return presetColor(override.name, 'preset', paletteId);
	}
	if (strategy.mode === 'distinct' || strategy.mode === 'smart') {
		const entry = automaticTemplateColor(identity, paletteId);
		return { ...filledColor(entry.hex, entry.label, 'auto'), label: `Auto · ${entry.label}` };
	}
	const choice = strategyColor(identity, strategy, (value) => automaticPreset(value));
	if (choice === 'disabled') return disabledColor();
	if (choice === 'neutral') return neutralColor('Neutral');
	const color = presetColor(choice, 'auto', paletteId);
	const prefix = strategy.mode === 'status' ? 'Status'
			: strategy.mode === 'priority' ? 'Priority'
				: strategy.mode === 'single' ? 'Single'
					: '';
	return { ...color, label: prefix ? `${prefix} · ${color.label}` : color.label };
}
export function resolvePreset(name: PresetName, paletteId: PaletteTemplateId = 'default'): ResolvedColor {
	return name === 'default' ? neutralColor('Default') : presetColor(name, 'preset', paletteId);
}
export function resolveRuleColor(hex: string): ResolvedColor {
	const normalized = normalizeHex(hex) ?? '#787774';
	return filledColor(normalized, normalized, 'custom');
}
export function tintedHex(accentHex: string, surfaceHex: string, strength = 0.12): string {
	return rgbToHex(mixRgb(hexToRgb(surfaceHex), hexToRgb(accentHex), strength));
}
function presetColor(name: Exclude<PresetName, 'default'>, kind: 'auto' | 'preset', paletteId: PaletteTemplateId): ResolvedColor {
	const template = paletteTemplate(paletteId);
	const slotIndex = TEMPLATE_SLOT_NAMES.indexOf(name as TemplateSlotName);
	if (slotIndex >= 0) {
		const entry = template.colors[Math.min(slotIndex, template.colors.length - 1)] ?? template.colors[0]!;
		return filledColor(entry.hex, entry.label, kind);
	}
	const index = template.semanticIndexes[name as PaletteName];
	const entry = template.colors[index] ?? PALETTE_BY_NAME.get(name as PaletteName) ?? PALETTE[1]!;
	return filledColor(entry.hex, PALETTE_BY_NAME.get(name as PaletteName)?.label ?? entry.label, kind);
}
function filledColor(hex: string, label: string, kind: 'auto' | 'preset' | 'custom'): ResolvedColor {
	const lightBackground = tintedHex(hex, '#FFFFFF');
	const darkBackground = tintedHex(hex, '#1E1E1E');
	const solidBackground = solidBackgroundForWhite(hex);
	return {
		kind, label,
		background: `color-mix(in srgb, ${hex} 12%, transparent)`,
		hoverBackground: `color-mix(in srgb, ${hex} 18%, transparent)`,
		foregroundLight: adjustForContrast(hex, lightBackground),
		foregroundDark: adjustForContrast(hex, darkBackground),
		border: `color-mix(in srgb, ${hex} 28%, transparent)`, dot: hex,
		solidBackground,
		solidForeground: '#FFFFFF',
		solidHoverBackground: `color-mix(in srgb, ${solidBackground} 88%, black)`,
	};
}
function neutralColor(label: string): ResolvedColor {
	return { kind: 'neutral', label, background: 'color-mix(in srgb, var(--text-muted) 5%, transparent)', hoverBackground: 'color-mix(in srgb, var(--text-muted) 10%, transparent)', foregroundLight: 'var(--text-normal)', foregroundDark: 'var(--text-normal)', border: 'var(--background-modifier-border)', dot: 'var(--text-muted)', solidBackground: '#666666', solidForeground: '#FFFFFF', solidHoverBackground: '#555555' };
}
function disabledColor(): ResolvedColor {
	return { kind: 'disabled', label: 'Off', background: '', hoverBackground: '', foregroundLight: '', foregroundDark: '', border: '', dot: 'var(--text-faint)', solidBackground: '', solidForeground: '', solidHoverBackground: '' };
}

function solidBackgroundForWhite(accentHex: string): string {
	if (contrastRatio('#FFFFFF', accentHex) >= 4.5) return accentHex;
	const accent = hexToRgb(accentHex);
	const black = { r: 0, g: 0, b: 0 };
	for (let step = 1; step <= 100; step += 1) {
		const candidate = rgbToHex(mixRgb(accent, black, step / 100));
		if (contrastRatio('#FFFFFF', candidate) >= 4.5) return candidate;
	}
	return '#000000';
}

export function contrastRatio(firstHex: string, secondHex: string): number {
	const first = relativeLuminance(hexToRgb(firstHex));
	const second = relativeLuminance(hexToRgb(secondHex));
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export function adjustForContrast(foregroundHex: string, backgroundHex: string, minimumRatio = 4.5): string {
	const foreground = hexToRgb(foregroundHex);
	const background = hexToRgb(backgroundHex);
	if (contrastRatio(foregroundHex, backgroundHex) >= minimumRatio) return rgbToHex(foreground);
	const target: Rgb = relativeLuminance(background) > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
	for (let step = 1; step <= 100; step += 1) {
		const candidate = rgbToHex(mixRgb(foreground, target, step / 100));
		if (contrastRatio(candidate, backgroundHex) >= minimumRatio) return candidate;
	}
	return rgbToHex(target);
}
function hexToRgb(hex: string): Rgb {
	const normalized = normalizeHex(hex) ?? '#000000';
	return { r: parseInt(normalized.slice(1, 3), 16), g: parseInt(normalized.slice(3, 5), 16), b: parseInt(normalized.slice(5, 7), 16) };
}
function rgbToHex(rgb: Rgb): string {
	const channel = (value: number) => Math.round(value).toString(16).padStart(2, '0').toUpperCase();
	return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}
function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
	return { r: from.r + (to.r - from.r) * amount, g: from.g + (to.g - from.g) * amount, b: from.b + (to.b - from.b) * amount };
}
function relativeLuminance(rgb: Rgb): number {
	const linearize = (channel: number) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; };
	return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

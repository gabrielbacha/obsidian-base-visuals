import { strategyColor } from './property-strategies';
import { leadingOrderNumber } from './value-order';
import { AUTO_PRESET_NAMES, type ColorOverride, type OptionIdentity, type PaletteName, type PresetName, type PropertyColorStrategy } from './types';

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
const PALETTE_BY_NAME = new Map(PALETTE.map((entry) => [entry.name, entry]));
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
	if (PALETTE_BY_NAME.has(value as PaletteName)) return value as PaletteName;
	return LEGACY_PRESET_MAP[value] ?? null;
}
export function isPresetName(value: unknown): value is PresetName { return normalizePresetName(value) !== null; }

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

export function resolveColor(identity: OptionIdentity, override?: ColorOverride, strategy: PropertyColorStrategy = { mode: 'distinct' }): ResolvedColor {
	if (override?.kind === 'disabled') return disabledColor();
	if (override?.kind === 'custom') {
		const normalized = normalizeHex(override.hex);
		if (normalized) return filledColor(normalized, normalized, 'custom');
	}
	if (override?.kind === 'preset') {
		if (override.name === 'default') return neutralColor('Default');
		return presetColor(override.name, 'preset');
	}
	const choice = strategyColor(identity, strategy, automaticPreset);
	if (choice === 'disabled') return disabledColor();
	if (choice === 'neutral') return neutralColor('Neutral');
	const color = presetColor(choice, 'auto');
	const prefix = strategy.mode === 'distinct' ? 'Auto'
		: strategy.mode === 'status' ? 'Status'
			: strategy.mode === 'priority' ? 'Priority'
				: strategy.mode === 'single' ? 'Single'
					: '';
	return { ...color, label: prefix ? `${prefix} · ${color.label}` : color.label };
}
export function resolvePreset(name: PresetName): ResolvedColor {
	return name === 'default' ? neutralColor('Default') : presetColor(name, 'preset');
}
export function resolveRuleColor(hex: string): ResolvedColor {
	const normalized = normalizeHex(hex) ?? '#787774';
	return filledColor(normalized, normalized, 'custom');
}
export function tintedHex(accentHex: string, surfaceHex: string, strength = 0.12): string {
	return rgbToHex(mixRgb(hexToRgb(surfaceHex), hexToRgb(accentHex), strength));
}
function presetColor(name: PaletteName, kind: 'auto' | 'preset'): ResolvedColor {
	const entry = PALETTE_BY_NAME.get(name) ?? PALETTE[1]!;
	return filledColor(entry.hex, entry.label, kind);
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

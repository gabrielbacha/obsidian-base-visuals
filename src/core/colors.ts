import {
	AUTO_PRESET_NAMES,
	ColorOverride,
	OptionIdentity,
	PRESET_NAMES,
	PresetName,
} from './types';

export interface ResolvedColor {
	kind: 'auto' | 'preset' | 'custom' | 'disabled';
	label: string;
	background: string;
	hoverBackground: string;
	foregroundLight: string;
	foregroundDark: string;
	dot: string;
}

interface Rgb {
	r: number;
	g: number;
	b: number;
}

const PRESET_LABELS: Record<PresetName, string> = {
	default: 'Default',
	gray: 'Gray',
	brown: 'Brown',
	red: 'Red',
	orange: 'Orange',
	yellow: 'Yellow',
	green: 'Green',
	blue: 'Blue',
	purple: 'Purple',
	pink: 'Pink',
};

const PRESET_TOKENS: Record<
	PresetName,
	{ color: string; background: string; hover: string }
> = {
	default: {
		color: 'var(--text-muted)',
		background: 'var(--background-modifier-hover)',
		hover:
			'var(--background-modifier-active-hover, var(--background-modifier-hover))',
	},
	gray: presetTokens('gray'),
	brown: presetTokens('brown'),
	red: presetTokens('red'),
	orange: presetTokens('orange'),
	yellow: presetTokens('yellow'),
	green: presetTokens('green'),
	blue: presetTokens('blue'),
	purple: presetTokens('purple'),
	pink: presetTokens('pink'),
};

function presetTokens(name: Exclude<PresetName, 'default'>) {
	const fallbacks: Record<Exclude<PresetName, 'default'>, string> = {
		gray: '#787774',
		brown: '#9F6B53',
		red: '#D44C47',
		orange: '#D9730D',
		yellow: '#CB912F',
		green: '#448361',
		blue: '#337EA9',
		purple: '#9065B0',
		pink: '#C14C8A',
	};
	const color = `var(--color-${name}, ${fallbacks[name]})`;
	return {
		color,
		background: `color-mix(in srgb, ${color} 18%, transparent)`,
		hover: `color-mix(in srgb, ${color} 25%, transparent)`,
	};
}

export function encodeOptionKey(identity: OptionIdentity): string {
	return `${encodeURIComponent(identity.propertyId)}::${encodeURIComponent(identity.value)}`;
}

export function normalizeHex(input: string): string | null {
	const value = input.trim();
	const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value);
	if (!match?.[1]) return null;

	const raw = match[1].toUpperCase();
	if (raw.length === 3) {
		return `#${raw
			.split('')
			.map((character) => character.repeat(2))
			.join('')}`;
	}
	return `#${raw}`;
}

export function isPresetName(value: unknown): value is PresetName {
	return typeof value === 'string' && PRESET_NAMES.includes(value as PresetName);
}

export function automaticPreset(identity: OptionIdentity): PresetName {
	const key = `${identity.propertyId}\u0000${identity.value}`;
	let hash = 2166136261;
	for (let index = 0; index < key.length; index += 1) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	const paletteIndex = (hash >>> 0) % AUTO_PRESET_NAMES.length;
	return AUTO_PRESET_NAMES[paletteIndex] ?? 'blue';
}

export function resolveColor(
	identity: OptionIdentity,
	override?: ColorOverride,
): ResolvedColor {
	if (override?.kind === 'disabled') {
		return {
			kind: 'disabled',
			label: 'Off',
			background: '',
			hoverBackground: '',
			foregroundLight: '',
			foregroundDark: '',
			dot: 'var(--text-faint)',
		};
	}

	if (override?.kind === 'custom') {
		const normalized = normalizeHex(override.hex);
		if (normalized) return resolveCustomColor(normalized);
	}

	const preset =
		override?.kind === 'preset' ? override.name : automaticPreset(identity);
	const token = PRESET_TOKENS[preset];
	return {
		kind: override?.kind === 'preset' ? 'preset' : 'auto',
		label:
			override?.kind === 'preset'
				? PRESET_LABELS[preset]
				: `Auto · ${PRESET_LABELS[preset]}`,
		background: token.background,
		hoverBackground: token.hover,
		foregroundLight: token.color,
		foregroundDark: token.color,
		dot: token.color,
	};
}

export function resolvePreset(name: PresetName): ResolvedColor {
	return resolveColor(
		{ propertyId: '__preview__', value: name },
		{ kind: 'preset', name },
	);
}

function resolveCustomColor(hex: string): ResolvedColor {
	return {
		kind: 'custom',
		label: hex,
		background: `color-mix(in srgb, ${hex} 18%, transparent)`,
		hoverBackground: `color-mix(in srgb, ${hex} 25%, transparent)`,
		foregroundLight: adjustForContrast(hex, '#FFFFFF'),
		foregroundDark: adjustForContrast(hex, '#1E1E1E'),
		dot: hex,
	};
}

export function resolveRuleColor(hex: string): ResolvedColor {
	return resolveCustomColor(normalizeHex(hex) ?? '#787774');
}

export function contrastRatio(firstHex: string, secondHex: string): number {
	const first = relativeLuminance(hexToRgb(firstHex));
	const second = relativeLuminance(hexToRgb(secondHex));
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function adjustForContrast(
	foregroundHex: string,
	backgroundHex: string,
	minimumRatio = 4.5,
): string {
	const foreground = hexToRgb(foregroundHex);
	const background = hexToRgb(backgroundHex);
	if (contrastRatio(foregroundHex, backgroundHex) >= minimumRatio) {
		return rgbToHex(foreground);
	}

	const target: Rgb = relativeLuminance(background) > 0.5
		? { r: 0, g: 0, b: 0 }
		: { r: 255, g: 255, b: 255 };
	for (let step = 1; step <= 20; step += 1) {
		const amount = step / 20;
		const candidate = mixRgb(foreground, target, amount);
		const candidateHex = rgbToHex(candidate);
		if (contrastRatio(candidateHex, backgroundHex) >= minimumRatio) {
			return candidateHex;
		}
	}
	return rgbToHex(target);
}

function hexToRgb(hex: string): Rgb {
	const normalized = normalizeHex(hex) ?? '#000000';
	return {
		r: Number.parseInt(normalized.slice(1, 3), 16),
		g: Number.parseInt(normalized.slice(3, 5), 16),
		b: Number.parseInt(normalized.slice(5, 7), 16),
	};
}

function rgbToHex(rgb: Rgb): string {
	const channel = (value: number) =>
		Math.round(value).toString(16).padStart(2, '0').toUpperCase();
	return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
	return {
		r: from.r + (to.r - from.r) * amount,
		g: from.g + (to.g - from.g) * amount,
		b: from.b + (to.b - from.b) * amount,
	};
}

function relativeLuminance(rgb: Rgb): number {
	const linearize = (channel: number) => {
		const value = channel / 255;
		return value <= 0.04045
			? value / 12.92
			: ((value + 0.055) / 1.055) ** 2.4;
	};
	return (
		0.2126 * linearize(rgb.r) +
		0.7152 * linearize(rgb.g) +
		0.0722 * linearize(rgb.b)
	);
}

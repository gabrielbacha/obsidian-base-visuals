import {
	adjustForContrast,
	normalizeHex,
	normalizePresetName,
	resolvePreset,
	resolveRuleColor,
	tintedHex,
} from './colors';
import {
	ConditionalRule,
	RULE_OPERATORS,
	RuleColor,
	RuleOperator,
	PaletteTemplateId,
} from './types';

export interface RenderedCellValue {
	text: string;
	values: string[];
}

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
	equals: 'Equals',
	'not-equals': 'Does not equal',
	contains: 'Contains',
	'not-contains': 'Does not contain',
	'is-empty': 'Is empty',
	'is-not-empty': 'Is not empty',
	'greater-than': 'Greater than',
	'greater-or-equal': 'Greater than or equal',
	'less-than': 'Less than',
	'less-or-equal': 'Less than or equal',
};

export function isRuleOperator(value: unknown): value is RuleOperator {
	return typeof value === 'string' && RULE_OPERATORS.includes(value as RuleOperator);
}

export function operatorNeedsOperand(operator: RuleOperator): boolean {
	return operator !== 'is-empty' && operator !== 'is-not-empty';
}

export function evaluateRule(
	rule: Pick<ConditionalRule, 'operator' | 'operand'>,
	cell: RenderedCellValue,
): boolean {
	const values = (cell.values.length ? cell.values : [cell.text]).map(normalizeText);
	const operand = normalizeText(rule.operand ?? '');
	const empty = values.every((value) => value.length === 0);

	switch (rule.operator) {
		case 'is-empty': return empty;
		case 'is-not-empty': return !empty;
		case 'equals': return values.some((value) => value === operand);
		case 'not-equals': return values.every((value) => value !== operand);
		case 'contains': return values.some((value) => value.includes(operand));
		case 'not-contains': return values.every((value) => !value.includes(operand));
		default: return evaluateNumeric(rule.operator, cell.text, rule.operand ?? '');
	}
}

export function matchingRule(
	rules: readonly ConditionalRule[],
	propertyId: string,
	cell: RenderedCellValue,
	target: 'cell' | 'row',
): ConditionalRule | undefined {
	return rules.find((rule) =>
		rule.enabled &&
		ruleHasFormatting(rule) &&
		rule.target === target &&
		rule.propertyId === propertyId &&
		evaluateRule(rule, cell),
	);
}

export function ruleHasFormatting(
	rule: Pick<ConditionalRule, 'color' | 'fontColor' | 'bold' | 'strikethrough'>,
): boolean {
	return Boolean(rule.color || rule.fontColor || rule.bold || rule.strikethrough);
}

export function ruleColorVariables(
	color?: RuleColor,
	fontColor?: RuleColor,
	paletteId: PaletteTemplateId = 'default',
	backgroundOpacity?: number,
): {
	background: string;
	hover: string;
	foregroundLight: string;
	foregroundDark: string;
} {
	const resolved = color?.kind === 'preset'
		? resolvePreset(color.name, paletteId)
		: color ? resolveRuleColor(color.hex) : null;
	const text = fontColor
		? fontColor.kind === 'preset'
			? resolvePreset(fontColor.name, paletteId)
			: resolveRuleColor(fontColor.hex)
		: resolved;
	const opacity = effectiveRuleBackgroundOpacity(color, backgroundOpacity);
	const hoverOpacity = color ? Math.min(100, opacity + 6) : 0;
	const accent = color?.kind === 'preset' && color.name === 'default'
		? 'var(--text-muted)'
		: resolved?.dot ?? 'transparent';
	const background = opacity === 0
		? 'transparent'
		: `color-mix(in srgb, ${accent} ${opacity}%, transparent)`;
	const hover = hoverOpacity === 0
		? 'transparent'
		: `color-mix(in srgb, ${accent} ${hoverOpacity}%, transparent)`;
	if (!fontColor && color?.kind === 'preset' && color.name === 'default') {
		return {
			background,
			hover,
			foregroundLight: 'var(--text-muted)',
			foregroundDark: 'var(--text-muted)',
		};
	}
	if (fontColor?.kind === 'preset' && fontColor.name === 'default') {
		return {
			background,
			hover,
			foregroundLight: 'var(--text-muted)',
			foregroundDark: 'var(--text-muted)',
		};
	}
	const automaticForeground = !fontColor && resolved && /^#[0-9A-F]{6}$/i.test(resolved.dot)
		? {
			light: adjustForContrast(resolved.dot, tintedHex(resolved.dot, '#FFFFFF', hoverOpacity / 100)),
			dark: adjustForContrast(resolved.dot, tintedHex(resolved.dot, '#1E1E1E', hoverOpacity / 100)),
		}
		: null;
	return {
		background,
		hover,
		foregroundLight: fontColor ? text?.dot ?? 'inherit' : automaticForeground?.light ?? text?.foregroundLight ?? 'inherit',
		foregroundDark: fontColor ? text?.dot ?? 'inherit' : automaticForeground?.dark ?? text?.foregroundDark ?? 'inherit',
	};
}

export function effectiveRuleBackgroundOpacity(color?: RuleColor, stored?: number): number {
	if (!color) return 0;
	if (typeof stored === 'number' && Number.isFinite(stored)) {
		return Math.max(0, Math.min(100, Math.round(stored)));
	}
	return color.kind === 'preset' && color.name === 'default' ? 3 : 12;
}

export function normalizeRuleColor(value: unknown): RuleColor | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Record<string, unknown>;
	if (candidate.kind === 'preset') {
		const name = normalizePresetName(candidate.name);
		if (name) return { kind: 'preset', name };
	}
	if (candidate.kind === 'custom' && typeof candidate.hex === 'string') {
		const hex = normalizeHex(candidate.hex);
		return hex ? { kind: 'custom', hex } : null;
	}
	return null;
}

function normalizeText(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function evaluateNumeric(operator: RuleOperator, actualText: string, operandText: string): boolean {
	const actual = strictNumber(actualText);
	const operand = strictNumber(operandText);
	if (actual === null || operand === null) return false;
	switch (operator) {
		case 'greater-than': return actual > operand;
		case 'greater-or-equal': return actual >= operand;
		case 'less-than': return actual < operand;
		case 'less-or-equal': return actual <= operand;
		default: return false;
	}
}

function strictNumber(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return null;
	const number = Number(trimmed);
	return Number.isFinite(number) ? number : null;
}

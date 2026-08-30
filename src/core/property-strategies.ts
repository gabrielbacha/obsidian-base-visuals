import type { OptionIdentity, PaletteName, PalettePresetName, PropertyColorStrategy } from './types';

export type StrategyColor = PalettePresetName | 'neutral' | 'disabled';

const STATUS_PROPERTIES = new Set(['status', 'state', 'workflow', 'phase', 'stage']);
const PRIORITY_PROPERTIES = new Set(['priority', 'severity', 'urgency', 'prio']);
const SINGLE_PROPERTIES = new Set(['tags', 'tag', 'audience', 'label', 'labels']);
const NEUTRAL_PROPERTIES = new Set(['category', 'subcategory', 'addin', 'add in', 'plugin', 'section']);

const STATUS_GREEN = new Set([
	'done', 'complete', 'completed', 'closed', 'resolved', 'approved',
	'finished', 'released', 'shipped', 'passed', 'success', 'verified',
]);
const STATUS_BLUE = new Set([
	'in progress', 'active', 'started', 'doing', 'running', 'ongoing',
	'wip', 'working', 'in dev', 'in development', 'executing',
]);
const STATUS_PURPLE = new Set([
	'continuous', 'recurring', 'routine', 'maintenance', 'perpetual', 'evergreen',
]);
const STATUS_YELLOW = new Set([
	'review', 'in review', 'to review', 'under review', 'pending',
	'waiting', 'waiting for a dependency', 'waiting for dependency',
	'queued', 'scheduled', 'scheduled future date', 'upcoming',
	'ready for review', 'pr review',
]);
const STATUS_ORANGE = new Set([
	'on hold', 'paused', 'deferred', 'suspended', 'parked', 'standby', 'delayed',
]);
const STATUS_RED = new Set([
	'blocked', 'failed', 'rejected', 'cancelled', 'canceled', 'stuck',
	'error', 'broken', 'halted', 'aborted',
]);

const PRIORITY_HIGH = new Set([
	'high', 'urgent', 'critical', 'high priority', 'urgent priority', 'critical priority',
	'pnow', 'pnow priority', 'p0', 'p 0', 'p0 priority', 'blocker', 'showstopper',
	'highest', 'immediate', 'asap', 'emergency',
]);
const PRIORITY_MEDIUM = new Set([
	'medium', 'normal', 'medium priority', 'normal priority',
	'med', 'med priority', 'soon', 'soon priority',
	'p1', 'p 1', 'p1 priority', 'moderate', 'important',
]);
const PRIORITY_LOW_MID = new Set([
	'p2', 'p 2', 'p2 priority', 'minor',
]);

export function inferPropertyStrategy(propertyId: string, displayName?: string): PropertyColorStrategy {
	const candidates = propertyCandidates(propertyId, displayName);
	if (matchesPropertyFamily(candidates, STATUS_PROPERTIES)) return { mode: 'status' };
	if (matchesPropertyFamily(candidates, PRIORITY_PROPERTIES)) return { mode: 'priority' };
	if (matchesPropertyFamily(candidates, SINGLE_PROPERTIES)) return { mode: 'single', preset: 'peter-river' };
	if (matchesPropertyFamily(candidates, NEUTRAL_PROPERTIES)) return { mode: 'neutral' };
	return { mode: 'distinct' };
}

export function effectivePropertyStrategy(propertyId: string, displayName: string | undefined, explicit?: PropertyColorStrategy): PropertyColorStrategy {
	if (!explicit || explicit.mode === 'smart') {
		return { ...inferPropertyStrategy(propertyId, displayName), ...(explicit?.style ? { style: explicit.style } : {}) };
	}
	return explicit.mode === 'single'
		? { mode: 'single', preset: explicit.preset ?? 'peter-river', ...(explicit.style ? { style: explicit.style } : {}) }
		: explicit;
}

export function strategyColor(identity: OptionIdentity, strategy: PropertyColorStrategy, automatic: (identity: OptionIdentity) => PaletteName): StrategyColor {
	const value = normalizeSemanticValue(identity.value);
	switch (strategy.mode) {
		case 'off': return 'disabled';
		case 'neutral': return 'neutral';
		case 'single': return strategy.preset ?? 'peter-river';
		case 'status':
			if (STATUS_GREEN.has(value)) return 'green-sea';
			if (STATUS_BLUE.has(value)) return 'peter-river';
			if (STATUS_PURPLE.has(value)) return 'wisteria';
			if (STATUS_YELLOW.has(value)) return 'sun-flower';
			if (STATUS_ORANGE.has(value)) return 'carrot';
			if (STATUS_RED.has(value)) return 'pomegranate';
			return 'neutral';
		case 'priority':
			if (PRIORITY_HIGH.has(value)) return 'pomegranate';
			if (PRIORITY_MEDIUM.has(value)) return 'carrot';
			if (PRIORITY_LOW_MID.has(value)) return 'sun-flower';
			return 'neutral';
		default: return automatic(identity);
	}
}

export function strategyLabel(strategy: PropertyColorStrategy): string {
	return ({ smart: 'Smart', distinct: 'Distinct', status: 'Status', priority: 'Priority', single: 'Single color', neutral: 'Neutral', off: 'Off' })[strategy.mode];
}

function propertyCandidates(propertyId: string, displayName?: string): string[] {
	return [...new Set([propertyId, displayName ?? ''].flatMap((value) =>
		[normalizeWords(value), ...value.split(/[.:/]/).map(normalizeWords)]
			.flatMap((candidate) => [candidate, candidate.replaceAll(' ', '')]))
		.filter(Boolean))];
}

function matchesPropertyFamily(candidates: readonly string[], names: ReadonlySet<string>): boolean {
	return candidates.some((candidate) => {
		const words = candidate.split(' ').filter(Boolean);
		return words.some((word) => names.has(word)) || [...names].some((name) =>
			candidate === name || candidate.startsWith(`${name} `) || candidate.endsWith(` ${name}`) || candidate.includes(` ${name} `)
		);
	});
}

function normalizeWords(value: string): string {
	return value.trim().toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function normalizeSemanticValue(value: string): string {
	const withoutOrder = value.trim().replace(/^\d+\s*(?:(?:[.):\]-]|—|–)\s*|\s*)/u, '');
	const withoutParentheses = withoutOrder.replace(/\s*\([^)]*\)/g, '').trim();
	return normalizeWords(withoutParentheses || withoutOrder);
}

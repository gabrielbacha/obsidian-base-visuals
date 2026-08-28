import type { OptionIdentity, PaletteName, PropertyColorStrategy } from './types';

export type StrategyColor = PaletteName | 'neutral' | 'disabled';

const STATUS_PROPERTIES = new Set(['status', 'state', 'workflow']);
const PRIORITY_PROPERTIES = new Set(['priority', 'severity', 'urgency']);
const SINGLE_PROPERTIES = new Set(['tags', 'tag', 'audience']);
const NEUTRAL_PROPERTIES = new Set(['category', 'addin', 'add in', 'plugin']);
const STATUS_GREEN = new Set(['done', 'complete', 'closed', 'resolved', 'approved']);
const STATUS_BLUE = new Set(['in progress', 'active', 'started', 'doing']);
const STATUS_YELLOW = new Set(['review', 'in review', 'pending', 'waiting', 'queued']);
const STATUS_RED = new Set(['blocked', 'failed', 'rejected', 'cancelled', 'canceled']);

export function inferPropertyStrategy(propertyId: string, displayName?: string): PropertyColorStrategy {
	const candidates = propertyCandidates(propertyId, displayName);
	if (candidates.some((value) => STATUS_PROPERTIES.has(value))) return { mode: 'status' };
	if (candidates.some((value) => PRIORITY_PROPERTIES.has(value))) return { mode: 'priority' };
	if (candidates.some((value) => SINGLE_PROPERTIES.has(value))) return { mode: 'single', preset: 'peter-river' };
	if (candidates.some((value) => NEUTRAL_PROPERTIES.has(value))) return { mode: 'neutral' };
	return { mode: 'distinct' };
}

export function effectivePropertyStrategy(propertyId: string, displayName: string | undefined, explicit?: PropertyColorStrategy): PropertyColorStrategy {
	if (!explicit || explicit.mode === 'smart') return inferPropertyStrategy(propertyId, displayName);
	return explicit.mode === 'single' ? { mode: 'single', preset: explicit.preset ?? 'peter-river' } : explicit;
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
			if (STATUS_YELLOW.has(value)) return 'sun-flower';
			if (STATUS_RED.has(value)) return 'pomegranate';
			return 'neutral';
		case 'priority':
			if (value === 'medium' || value === 'normal' || value === 'medium priority' || value === 'normal priority') return 'carrot';
			if (value === 'high' || value === 'urgent' || value === 'critical' || value === 'high priority' || value === 'urgent priority' || value === 'critical priority') return 'pomegranate';
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

function normalizeWords(value: string): string {
	return value.trim().toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function normalizeSemanticValue(value: string): string {
	const withoutOrder = value.trim().replace(/^\d+\s*(?:(?:[.):\]-]|—|–)\s*|\s+)/u, '');
	return normalizeWords(withoutOrder);
}

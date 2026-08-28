import { describe, expect, it } from 'vitest';
import { resolveColor } from '../src/core/colors';
import { effectivePropertyStrategy, inferPropertyStrategy, strategyColor } from '../src/core/property-strategies';

describe('property color strategies', () => {
	it('infers Smart strategies from exact IDs and display names across separators and case', () => {
		expect(inferPropertyStrategy('note.STATUS')).toEqual({ mode: 'status' });
		expect(inferPropertyStrategy('formula.unknown', 'Work_flow')).toEqual({ mode: 'status' });
		expect(inferPropertyStrategy('note.priority-level', 'Priority')).toEqual({ mode: 'priority' });
		expect(inferPropertyStrategy('note.tags')).toEqual({ mode: 'single', preset: 'peter-river' });
		expect(inferPropertyStrategy('note.add-in')).toEqual({ mode: 'neutral' });
		expect(inferPropertyStrategy('note.owner')).toEqual({ mode: 'distinct' });
	});

	it('maps complete status and priority values and keeps unknown values neutral', () => {
		const status = { mode: 'status' } as const;
		for (const value of ['Done', 'complete', 'closed', 'resolved', 'approved']) {
			expect(strategyColor({ propertyId: 'status', value }, status, () => 'raspberry')).toBe('green-sea');
		}
		for (const value of ['In_progress', 'active', 'started', 'doing']) {
			expect(strategyColor({ propertyId: 'status', value }, status, () => 'raspberry')).toBe('peter-river');
		}
		for (const value of ['review', 'pending', 'waiting', 'queued']) {
			expect(strategyColor({ propertyId: 'status', value }, status, () => 'raspberry')).toBe('sun-flower');
		}
		for (const value of ['blocked', 'failed', 'rejected', 'cancelled']) {
			expect(strategyColor({ propertyId: 'status', value }, status, () => 'raspberry')).toBe('pomegranate');
		}
		expect(strategyColor({ propertyId: 'status', value: 'draft' }, status, () => 'raspberry')).toBe('neutral');
		expect(strategyColor({ propertyId: 'priority', value: 'low' }, { mode: 'priority' }, () => 'raspberry')).toBe('neutral');
		expect(strategyColor({ propertyId: 'priority', value: 'normal' }, { mode: 'priority' }, () => 'raspberry')).toBe('carrot');
		expect(strategyColor({ propertyId: 'priority', value: 'critical' }, { mode: 'priority' }, () => 'raspberry')).toBe('pomegranate');
	});

	it('supports ordered semantic labels without enabling loose substring matches', () => {
		const automatic = () => 'raspberry' as const;
		for (const value of ['1. In Progress', '02 - In Progress', '3) In Progress', '04: In Progress', '5 In Progress']) {
			expect(strategyColor({ propertyId: 'status', value }, { mode: 'status' }, automatic)).toBe('peter-river');
		}
		expect(strategyColor({ propertyId: 'status', value: '2. Done' }, { mode: 'status' }, automatic)).toBe('green-sea');
		expect(strategyColor({ propertyId: 'priority', value: '1 - High priority' }, { mode: 'priority' }, automatic)).toBe('pomegranate');
		expect(strategyColor({ propertyId: 'status', value: 'Progress report' }, { mode: 'status' }, automatic)).toBe('neutral');
	});

	it('lets exact value overrides win over strategies', () => {
		const identity = { propertyId: 'note.status', value: 'Done' };
		expect(resolveColor(identity, undefined, { mode: 'status' }).dot).toBe('#16A085');
		expect(resolveColor(identity, { kind: 'preset', name: 'raspberry' }, { mode: 'status' }).dot).toBe('#D33682');
		expect(resolveColor(identity, { kind: 'disabled' }, { mode: 'status' }).kind).toBe('disabled');
	});

	it('resolves Smart without persisting a derived choice', () => {
		expect(effectivePropertyStrategy('note.status', undefined)).toEqual({ mode: 'status' });
		expect(effectivePropertyStrategy('note.status', undefined, { mode: 'neutral' })).toEqual({ mode: 'neutral' });
	});

	it('resolves Distinct, Single color, Neutral, and Off modes', () => {
		const identity = { propertyId: 'note.owner', value: 'Gabriel' };
		expect(strategyColor(identity, { mode: 'distinct' }, () => 'wisteria')).toBe('wisteria');
		expect(strategyColor(identity, { mode: 'single', preset: 'chestnut' }, () => 'wisteria')).toBe('chestnut');
		expect(resolveColor(identity, undefined, { mode: 'neutral' }).kind).toBe('neutral');
		expect(resolveColor(identity, undefined, { mode: 'off' }).kind).toBe('disabled');
	});
});

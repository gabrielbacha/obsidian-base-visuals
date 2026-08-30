import { describe, expect, it } from 'vitest';
import { resolveColor } from '../src/core/colors';
import { effectivePropertyStrategy, inferPropertyStrategy, strategyColor } from '../src/core/property-strategies';

describe('property color strategies', () => {
	it('infers Smart strategies from exact IDs and display names across separators and case', () => {
		expect(inferPropertyStrategy('note.STATUS')).toEqual({ mode: 'status' });
		expect(inferPropertyStrategy('note.status_todo')).toEqual({ mode: 'status' });
		expect(inferPropertyStrategy('note.agent_status')).toEqual({ mode: 'status' });
		expect(inferPropertyStrategy('note.sprint_status')).toEqual({ mode: 'status' });
		expect(inferPropertyStrategy('note.project_status')).toEqual({ mode: 'status' });
		expect(inferPropertyStrategy('formula.unknown', 'Work_flow')).toEqual({ mode: 'status' });
		expect(inferPropertyStrategy('note.priority_todo')).toEqual({ mode: 'priority' });
		expect(inferPropertyStrategy('note.urgency_todo')).toEqual({ mode: 'priority' });
		expect(inferPropertyStrategy('note.sprint_priority')).toEqual({ mode: 'priority' });
		expect(inferPropertyStrategy('note.priority-level', 'Priority')).toEqual({ mode: 'priority' });
		expect(inferPropertyStrategy('note.tags')).toEqual({ mode: 'single', preset: 'peter-river' });
		expect(inferPropertyStrategy('note.subcategory_todo')).toEqual({ mode: 'neutral' });
		expect(inferPropertyStrategy('note.add-in')).toEqual({ mode: 'neutral' });
		expect(inferPropertyStrategy('note.owner')).toEqual({ mode: 'distinct' });
	});

	it('maps complete status and priority values and keeps unknown values neutral', () => {
		const status = { mode: 'status' } as const;
		for (const value of ['Done', 'complete', 'closed', 'resolved', 'approved', 'released', 'shipped']) {
			expect(strategyColor({ propertyId: 'status', value }, status, () => 'raspberry')).toBe('green-sea');
		}
		for (const value of ['In_progress', 'active', 'started', 'doing', 'wip', 'in development']) {
			expect(strategyColor({ propertyId: 'status', value }, status, () => 'raspberry')).toBe('peter-river');
		}
		for (const value of ['continuous', 'recurring', 'routine', 'maintenance']) {
			expect(strategyColor({ propertyId: 'status', value }, status, () => 'raspberry')).toBe('wisteria');
		}
		for (const value of ['review', 'to review', 'pending', 'waiting', 'queued', 'scheduled']) {
			expect(strategyColor({ propertyId: 'status', value }, status, () => 'raspberry')).toBe('sun-flower');
		}
		for (const value of ['on hold', 'paused', 'deferred', 'suspended']) {
			expect(strategyColor({ propertyId: 'status', value }, status, () => 'raspberry')).toBe('carrot');
		}
		for (const value of ['blocked', 'failed', 'rejected', 'cancelled', 'stuck']) {
			expect(strategyColor({ propertyId: 'status', value }, status, () => 'raspberry')).toBe('pomegranate');
		}
		expect(strategyColor({ propertyId: 'status', value: 'draft' }, status, () => 'raspberry')).toBe('neutral');
		expect(strategyColor({ propertyId: 'status', value: 'not started' }, status, () => 'raspberry')).toBe('neutral');
		expect(strategyColor({ propertyId: 'priority', value: 'low' }, { mode: 'priority' }, () => 'raspberry')).toBe('neutral');
		expect(strategyColor({ propertyId: 'priority', value: 'can wait' }, { mode: 'priority' }, () => 'raspberry')).toBe('neutral');
		expect(strategyColor({ propertyId: 'priority', value: 'normal' }, { mode: 'priority' }, () => 'raspberry')).toBe('carrot');
		expect(strategyColor({ propertyId: 'priority', value: 'med' }, { mode: 'priority' }, () => 'raspberry')).toBe('carrot');
		expect(strategyColor({ propertyId: 'priority', value: 'soon' }, { mode: 'priority' }, () => 'raspberry')).toBe('carrot');
		expect(strategyColor({ propertyId: 'priority', value: 'p1' }, { mode: 'priority' }, () => 'raspberry')).toBe('carrot');
		expect(strategyColor({ propertyId: 'priority', value: 'p2' }, { mode: 'priority' }, () => 'raspberry')).toBe('sun-flower');
		expect(strategyColor({ propertyId: 'priority', value: 'p0' }, { mode: 'priority' }, () => 'raspberry')).toBe('pomegranate');
		expect(strategyColor({ propertyId: 'priority', value: 'pnow' }, { mode: 'priority' }, () => 'raspberry')).toBe('pomegranate');
		expect(strategyColor({ propertyId: 'priority', value: 'critical' }, { mode: 'priority' }, () => 'raspberry')).toBe('pomegranate');
		expect(strategyColor({ propertyId: 'priority', value: 'urgent' }, { mode: 'priority' }, () => 'raspberry')).toBe('pomegranate');
	});

	it('supports ordered semantic labels and parenthetical descriptions', () => {
		const automatic = () => 'raspberry' as const;
		const status = { mode: 'status' } as const;
		const priority = { mode: 'priority' } as const;

		expect(strategyColor({ propertyId: 'status_todo', value: '1.Not Started' }, status, automatic)).toBe('neutral');
		expect(strategyColor({ propertyId: 'status_todo', value: '2.In Progress' }, status, automatic)).toBe('peter-river');
		expect(strategyColor({ propertyId: 'status_todo', value: '3.Waiting (for a dependency)' }, status, automatic)).toBe('sun-flower');
		expect(strategyColor({ propertyId: 'status_todo', value: '4.To Review' }, status, automatic)).toBe('sun-flower');
		expect(strategyColor({ propertyId: 'status_todo', value: '5.Scheduled (future date)' }, status, automatic)).toBe('sun-flower');
		expect(strategyColor({ propertyId: 'status_todo', value: '6.On Hold (Paused)' }, status, automatic)).toBe('carrot');
		expect(strategyColor({ propertyId: 'status_todo', value: '7.Continuous' }, status, automatic)).toBe('wisteria');
		expect(strategyColor({ propertyId: 'status_todo', value: '8.Done' }, status, automatic)).toBe('green-sea');

		expect(strategyColor({ propertyId: 'sprint_status', value: '1.Queued' }, status, automatic)).toBe('sun-flower');
		expect(strategyColor({ propertyId: 'sprint_status', value: '2.Active' }, status, automatic)).toBe('peter-river');
		expect(strategyColor({ propertyId: 'sprint_status', value: '3.Blocked' }, status, automatic)).toBe('pomegranate');
		expect(strategyColor({ propertyId: 'sprint_status', value: '4.Review' }, status, automatic)).toBe('sun-flower');
		expect(strategyColor({ propertyId: 'sprint_status', value: '5.Done' }, status, automatic)).toBe('green-sea');

		expect(strategyColor({ propertyId: 'priority_todo', value: '1.High' }, priority, automatic)).toBe('pomegranate');
		expect(strategyColor({ propertyId: 'priority_todo', value: '2.Med' }, priority, automatic)).toBe('carrot');
		expect(strategyColor({ propertyId: 'priority_todo', value: '3.Low' }, priority, automatic)).toBe('neutral');

		expect(strategyColor({ propertyId: 'urgency_todo', value: '1.Urgent' }, priority, automatic)).toBe('pomegranate');
		expect(strategyColor({ propertyId: 'urgency_todo', value: '2.Soon' }, priority, automatic)).toBe('carrot');
		expect(strategyColor({ propertyId: 'urgency_todo', value: '3.Can Wait' }, priority, automatic)).toBe('neutral');

		expect(strategyColor({ propertyId: 'sprint_priority', value: '1.PNOW' }, priority, automatic)).toBe('pomegranate');
		expect(strategyColor({ propertyId: 'sprint_priority', value: '2.P0' }, priority, automatic)).toBe('pomegranate');
		expect(strategyColor({ propertyId: 'sprint_priority', value: '3.P1' }, priority, automatic)).toBe('carrot');
		expect(strategyColor({ propertyId: 'sprint_priority', value: '4.P2' }, priority, automatic)).toBe('sun-flower');

		expect(strategyColor({ propertyId: 'status', value: 'Progress report' }, status, automatic)).toBe('neutral');
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

import { describe, expect, it } from 'vitest';
import { evaluateRule, matchingRule, normalizeRuleColor } from '../src/core/rules';
import type { ConditionalRule } from '../src/core/types';

describe('conditional formatting rules', () => {
	it('matches text case-insensitively while preserving exact operator behavior', () => {
		const cell = { text: '  In Progress  ', values: ['In Progress'] };
		expect(evaluateRule({ operator: 'equals', operand: 'in progress' }, cell)).toBe(true);
		expect(evaluateRule({ operator: 'contains', operand: 'PROG' }, cell)).toBe(true);
		expect(evaluateRule({ operator: 'not-equals', operand: 'done' }, cell)).toBe(true);
	});

	it('matches individual list values and empty cells', () => {
		const list = { text: 'Alpha, Beta', values: ['Alpha', 'Beta'] };
		expect(evaluateRule({ operator: 'equals', operand: 'beta' }, list)).toBe(true);
		expect(evaluateRule({ operator: 'not-contains', operand: 'eta' }, list)).toBe(false);
		expect(evaluateRule({ operator: 'is-empty' }, { text: ' ', values: [''] })).toBe(true);
	});

	it('rejects invalid numbers and evaluates all numeric operators', () => {
		const cell = { text: '42.5', values: ['42.5'] };
		expect(evaluateRule({ operator: 'greater-than', operand: '40' }, cell)).toBe(true);
		expect(evaluateRule({ operator: 'less-or-equal', operand: '42.5' }, cell)).toBe(true);
		expect(evaluateRule({ operator: 'greater-than', operand: '4x' }, cell)).toBe(false);
		expect(evaluateRule({ operator: 'less-than', operand: '3' }, { text: 'n/a', values: ['n/a'] })).toBe(false);
	});

	it('uses the first enabled matching rule for a target', () => {
		const rules = [rule('first', 'row'), rule('second', 'row'), rule('cell', 'cell')];
		expect(matchingRule(rules, 'note.status', { text: 'Done', values: ['Done'] }, 'row')?.id).toBe('first');
		rules[0]!.enabled = false;
		expect(matchingRule(rules, 'note.status', { text: 'Done', values: ['Done'] }, 'row')?.id).toBe('second');
	});

	it('normalizes valid colors and ignores malformed colors', () => {
		expect(normalizeRuleColor({ kind: 'custom', hex: 'abc' })).toEqual({ kind: 'custom', hex: '#AABBCC' });
		expect(normalizeRuleColor({ kind: 'preset', name: 'green' })).toEqual({ kind: 'preset', name: 'green-sea' });
		expect(normalizeRuleColor({ kind: 'preset', name: 'teal' })).toBeNull();
	});
});

function rule(id: string, target: 'cell' | 'row'): ConditionalRule {
	return {
		id,
		name: id,
		enabled: true,
		propertyId: 'note.status',
		operator: 'equals',
		operand: 'done',
		target,
		color: { kind: 'preset', name: 'green-sea' },
	};
}

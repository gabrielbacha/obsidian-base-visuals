import { describe, expect, it } from 'vitest';
import { compareNaturalValues, leadingOrderNumber } from '../src/core/value-order';

describe('value ordering', () => {
	it('sorts numbered labels naturally', () => {
		const values = ['17. Later', '2. Second', '1. First', '13. Middle', '10. Tenth'];
		expect(values.sort(compareNaturalValues)).toEqual([
			'1. First', '2. Second', '10. Tenth', '13. Middle', '17. Later',
		]);
	});

	it('recognizes only a genuine leading order number', () => {
		expect(leadingOrderNumber('12. Change')).toBe(12);
		expect(leadingOrderNumber(' 3 - Capture')).toBe(3);
		expect(leadingOrderNumber('12factor')).toBeNull();
	});
});

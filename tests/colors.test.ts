import { describe, expect, it } from 'vitest';
import {
	adjustForContrast,
	automaticPreset,
	contrastRatio,
	encodeOptionKey,
	normalizeHex,
} from '../src/core/colors';

describe('color utilities', () => {
	it('encodes property and value without collisions', () => {
		expect(
			encodeOptionKey({ propertyId: 'note.a::b', value: 'x/y %' }),
		).not.toBe(encodeOptionKey({ propertyId: 'note.a', value: 'b::x/y %' }));
	});

	it('keeps automatic colors stable and property-aware', () => {
		const identity = { propertyId: 'note.status', value: 'In progress' };
		expect(automaticPreset(identity)).toBe(automaticPreset(identity));
		const results = new Set(
			Array.from({ length: 20 }, (_, index) =>
				automaticPreset({ propertyId: `note.property-${index}`, value: 'Same' }),
			),
		);
		expect(results.size).toBeGreaterThan(1);
	});

	it('normalizes three and six digit hex colors', () => {
		expect(normalizeHex('abc')).toBe('#AABBCC');
		expect(normalizeHex(' #12aBef ')).toBe('#12ABEF');
		expect(normalizeHex('#12')).toBeNull();
		expect(normalizeHex('red')).toBeNull();
	});

	it('adjusts custom foregrounds to WCAG AA contrast', () => {
		const onLight = adjustForContrast('#F5C2D8', '#FFFFFF');
		const onDark = adjustForContrast('#172033', '#1E1E1E');
		expect(contrastRatio(onLight, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(onDark, '#1E1E1E')).toBeGreaterThanOrEqual(4.5);
	});
});

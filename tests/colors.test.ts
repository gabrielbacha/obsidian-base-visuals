import { describe, expect, it } from 'vitest';
import {
	adjustForContrast,
	automaticPreset,
	contrastRatio,
	encodeOptionKey,
	normalizeHex,
	resolvePreset,
	PALETTE,
	tintedHex,
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

	it('exposes exactly the final palette in its specified order', () => {
		expect(PALETTE).toEqual([
			{ name: 'green-sea', label: 'Green Sea', hex: '#16A085' },
			{ name: 'peter-river', label: 'Peter River', hex: '#3498DB' },
			{ name: 'wisteria', label: 'Wisteria', hex: '#8E44AD' },
			{ name: 'midnight-blue', label: 'Midnight Blue', hex: '#2C3E50' },
			{ name: 'raspberry', label: 'Raspberry', hex: '#D33682' },
			{ name: 'sun-flower', label: 'Sun Flower', hex: '#F1C40F' },
			{ name: 'carrot', label: 'Carrot', hex: '#E67E22' },
			{ name: 'pomegranate', label: 'Pomegranate', hex: '#C0392B' },
			{ name: 'chestnut', label: 'Chestnut', hex: '#8B5A2B' },
		]);
	});

	it('gives every preset AA text contrast over light and dark tints', () => {
		for (const entry of PALETTE) {
			const resolved = resolvePreset(entry.name);
			expect(contrastRatio(resolved.foregroundLight, tintedHex(entry.hex, '#FFFFFF'))).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(resolved.foregroundDark, tintedHex(entry.hex, '#1E1E1E'))).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('adjusts custom foregrounds to WCAG AA contrast', () => {
		const onLight = adjustForContrast('#F5C2D8', '#FFFFFF');
		const onDark = adjustForContrast('#172033', '#1E1E1E');
		expect(contrastRatio(onLight, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(onDark, '#1E1E1E')).toBeGreaterThanOrEqual(4.5);
	});
});

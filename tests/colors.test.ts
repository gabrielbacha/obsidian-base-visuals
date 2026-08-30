import { describe, expect, it } from 'vitest';
import {
	adjustForContrast,
	automaticPreset,
	contrastRatio,
	encodeOptionKey,
	normalizeHex,
	resolvePreset,
	resolveColor,
	PALETTE,
	PALETTE_TEMPLATES,
	paletteTemplate,
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

	it('cycles ordered Distinct values through the palette by their leading number', () => {
		expect(automaticPreset({ propertyId: 'note.capabilities', value: '1. Onboarding' })).toBe('green-sea');
		expect(automaticPreset({ propertyId: 'note.capabilities', value: '2. Orientation' })).toBe('peter-river');
		expect(automaticPreset({ propertyId: 'note.capabilities', value: '12. Change' })).toBe('wisteria');
		expect(automaticPreset({ propertyId: 'note.capabilities', value: '13. Open' })).toBe('midnight-blue');
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

	it('chooses AA text contrast for every Solid palette background', () => {
		for (const entry of PALETTE) {
			const resolved = resolvePreset(entry.name);
			expect(resolved.solidForeground).toBe('#FFFFFF');
			expect(contrastRatio(resolved.solidForeground, resolved.solidBackground)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('provides the default palette plus seven compatible templates', () => {
		expect(PALETTE_TEMPLATES).toHaveLength(8);
		expect(PALETTE_TEMPLATES[0]?.id).toBe('default');
		expect(paletteTemplate('sunset-spectrum').colors).toHaveLength(10);
		expect(paletteTemplate('editorial').colors).toHaveLength(8);
		expect(resolvePreset('green-sea', 'sunset-spectrum').dot).not.toBe(resolvePreset('green-sea', 'default').dot);
		expect(PALETTE_TEMPLATES.slice(1).map((template) => template.colors.map((entry) => entry.hex))).toEqual([
			['#F94144', '#F3722C', '#F8961E', '#F9844A', '#F9C74F', '#90BE6D', '#43AA8B', '#4D908E', '#577590', '#277DA1'],
			['#001219', '#005F73', '#0A9396', '#94D2BD', '#E9D8A6', '#EE9B00', '#CA6702', '#BB3E03', '#AE2012', '#9B2226'],
			['#003C71', '#3A8F5B', '#E24E1B', '#FCBF49', '#EAE2B7', '#F5F5F5', '#898989', '#3A3A3A'],
			['#03045E', '#023E8A', '#0077B6', '#0096C7', '#00B4D8', '#48CAE4', '#90E0EF', '#ADE8F4', '#CAF0F8'],
			['#03071E', '#370617', '#6A040F', '#9D0208', '#D00000', '#DC2F02', '#E85D04', '#F48C06', '#FAA307', '#FFBA08'],
			['#007F5F', '#2B9348', '#55A630', '#80B918', '#AACC00', '#BFD200', '#D4D700', '#DDDF00', '#EEEF20', '#FFFF3F'],
			['#F72585', '#B5179E', '#7209B7', '#560BAD', '#480CA8', '#3A0CA3', '#3F37C9', '#4361EE', '#4895EF', '#4CC9F0'],
		]);
	});

	it('keeps every template readable in soft and solid styles', () => {
		for (const template of PALETTE_TEMPLATES) {
			for (const entry of template.colors) {
				const resolved = resolvePreset(entry.name, template.id);
				expect(contrastRatio(resolved.foregroundLight, tintedHex(entry.hex, '#FFFFFF'))).toBeGreaterThanOrEqual(4.5);
				expect(contrastRatio(resolved.solidForeground, resolved.solidBackground)).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it('uses every template color for ordered Distinct values and preserves semantic roles', () => {
		expect(resolveColor({ propertyId: 'note.capability', value: '10. Final' }, undefined, { mode: 'distinct' }, 'sunset-spectrum').dot).toBe('#277DA1');
		expect(resolveColor({ propertyId: 'note.capability', value: '11. Repeat' }, undefined, { mode: 'distinct' }, 'sunset-spectrum').dot).toBe('#F94144');
		expect(resolveColor({ propertyId: 'note.status', value: 'Done' }, undefined, { mode: 'status' }, 'ocean-depth').dot).toBe('#00B4D8');
	});

	it('adjusts custom foregrounds to WCAG AA contrast', () => {
		const onLight = adjustForContrast('#F5C2D8', '#FFFFFF');
		const onDark = adjustForContrast('#172033', '#1E1E1E');
		expect(contrastRatio(onLight, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(onDark, '#1E1E1E')).toBeGreaterThanOrEqual(4.5);
	});
});

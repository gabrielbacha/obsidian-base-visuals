import { describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../src/core/settings-store';

describe('SettingsStore', () => {
	it('normalizes malformed and legacy-shaped data safely', () => {
		const settings = SettingsStore.normalize({
			schemaVersion: 999,
			managerSearch: 'status',
			options: {
				old: {
					propertyId: ' note.status ',
					value: ' Done ',
					override: { kind: 'custom', hex: 'abc' },
				},
				bad: {
					propertyId: 'note.priority',
					value: 'Later',
					override: { kind: 'custom', hex: 'not-a-color' },
				},
			},
		});

		expect(settings.schemaVersion).toBe(4);
		expect(Object.values(settings.options)).toEqual([
			{
				propertyId: 'note.status',
				value: 'Done',
				override: { kind: 'custom', hex: '#AABBCC' },
			},
			{ propertyId: 'note.priority', value: 'Later' },
		]);
	});

	it('preserves exact case-sensitive values and resets overrides', () => {
		const save = vi.fn(async () => undefined);
		const store = new SettingsStore(SettingsStore.normalize(null), save);
		store.setOverride(
			{ propertyId: 'note.status', value: 'Done' },
			{ kind: 'preset', name: 'green' },
		);
		store.setOverride(
			{ propertyId: 'note.status', value: 'done' },
			{ kind: 'disabled' },
		);

		expect(store.allOptions()).toHaveLength(2);
		store.resetProperty('note.status');
		expect(store.allOptions().every((option) => !option.override)).toBe(true);
		store.dispose();
	});

	it('migrates schema one settings and rejects malformed rules', () => {
		const settings = SettingsStore.normalize({
			schemaVersion: 1,
			options: {},
			rules: [
				{
					id: 'valid', name: 'Done', enabled: true,
					propertyId: 'note.status', operator: 'equals', operand: 'done',
					target: 'row', color: { kind: 'custom', hex: 'abc' },
				},
				{ propertyId: 'note.status', operator: 'mystery', target: 'cell', color: { kind: 'preset', name: 'red' } },
			],
		});

		expect(settings.schemaVersion).toBe(4);
		expect(settings.rules).toHaveLength(1);
		expect(settings.rules[0]?.color).toEqual({ kind: 'custom', hex: '#AABBCC' });
		expect(settings.knownProperties['note.status']).toEqual({ propertyId: 'note.status' });
	});

	it('adds, duplicates, reorders, updates, and deletes rules', () => {
		const store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		const first = store.addRule('note.status');
		const second = store.addRule('note.priority');
		store.updateRule(first.id, { operand: 'done', target: 'row' });
		store.moveRule(second.id, -1);
		expect(store.settings.rules.map((rule) => rule.id)).toEqual([second.id, first.id]);
		store.duplicateRule(first.id);
		expect(store.settings.rules).toHaveLength(3);
		expect(store.settings.rules[2]?.name).toContain('copy');
		store.deleteRule(second.id);
		expect(store.settings.rules).toHaveLength(2);
		store.dispose();
	});

	it('normalizes, saves, and deletes complete layout presets', () => {
		const settings = SettingsStore.normalize({
			layoutPresets: [
				{
					id: 'writing', name: ' Writing ', rowHeight: 'tall',
					columnWidth: 184.6, columnScope: 'all',
				},
				{
					id: 'too-wide', name: 'Maximum-ish', rowHeight: '',
					columnWidth: 900, columnScope: 'unset',
				},
				{ id: 'bad', name: '', rowHeight: 'medium', columnWidth: 120, columnScope: 'all' },
				{ id: 'bad-width', name: 'Nope', rowHeight: 'giant', columnWidth: 120, columnScope: 'all' },
			],
		});
		expect(settings.layoutPresets).toEqual([
			{
				id: 'writing', name: 'Writing', rowHeight: 'tall',
				columnWidth: 185, columnScope: 'all',
			},
			{
				id: 'too-wide', name: 'Maximum-ish', rowHeight: '',
				columnWidth: 300, columnScope: 'unset',
			},
		]);

		const store = new SettingsStore(settings, vi.fn(async () => undefined));
		const added = store.addLayoutPreset('Reading', 'extra', 142, 'all');
		expect(added).toMatchObject({
			name: 'Reading', rowHeight: 'extra', columnWidth: 142, columnScope: 'all',
		});
		if (added) store.deleteLayoutPreset(added.id);
		expect(store.settings.layoutPresets.map((preset) => preset.name))
			.toEqual(['Writing', 'Maximum-ish']);
		store.setLastColumnWidthPreset(185);
		expect(store.settings.lastColumnWidthPreset).toBe(185);
		store.dispose();
	});
});

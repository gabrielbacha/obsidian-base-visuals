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

	expect(settings.schemaVersion).toBe(8);
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
			{ kind: 'preset', name: 'green-sea' },
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
					fontColor: { kind: 'preset', name: 'red' },
					bold: true, strikethrough: true,
					backgroundOpacity: 120.6, rowHeight: 'collapsed',
				},
				{ propertyId: 'note.status', operator: 'mystery', target: 'cell', color: { kind: 'preset', name: 'red' } },
			],
		});

	expect(settings.schemaVersion).toBe(8);
		expect(settings.rules).toHaveLength(1);
		expect(settings.rules[0]?.color).toEqual({ kind: 'custom', hex: '#AABBCC' });
		expect(settings.rules[0]?.fontColor).toEqual({ kind: 'preset', name: 'pomegranate' });
		expect(settings.rules[0]).toMatchObject({
			bold: true, strikethrough: true, backgroundOpacity: 100,
		});
		expect(settings.rules[0]).not.toHaveProperty('rowHeight');
		expect(settings.knownProperties['note.status']).toEqual({ propertyId: 'note.status' });
	});

	it('stores pill style independently from the inferred or explicit strategy', () => {
		const store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.setPropertyStyle('note.status', 'solid');
		expect(store.getExplicitPropertyStrategy('note.status')).toEqual({ mode: 'smart', style: 'solid' });
		expect(store.getPropertyStrategy('note.status')).toEqual({ mode: 'status', style: 'solid' });
		store.setPropertyStrategy('note.status', { mode: 'priority' });
		expect(store.getExplicitPropertyStrategy('note.status')).toEqual({ mode: 'priority', style: 'solid' });
		store.setPropertyStyle('note.status', 'soft');
		expect(store.getExplicitPropertyStrategy('note.status')).toEqual({ mode: 'priority' });
		store.setPropertyStrategy('note.status', undefined);
		expect(store.getExplicitPropertyStrategy('note.status')).toBeUndefined();
		store.dispose();
	});

	it('preserves non-default pill styles attached to Smart during normalization', () => {
		const settings = SettingsStore.normalize({
			propertyStrategies: {
				'note.priority_todo': { mode: 'smart', style: 'solid' },
				'note.workstream_todo': { mode: 'smart', style: 'outline' },
				'note.default': { mode: 'smart' },
			},
		});
		expect(settings.propertyStrategies).toEqual({
			'note.priority_todo': { mode: 'smart', style: 'solid' },
			'note.workstream_todo': { mode: 'smart', style: 'outline' },
		});
	});

	it('normalizes and persists a selected palette template', () => {
		const save = vi.fn(async () => undefined);
		const store = new SettingsStore(SettingsStore.normalize({ paletteTemplateId: 'ocean-depth' }), save);
		expect(store.getPaletteTemplateId()).toBe('ocean-depth');
		store.setPaletteTemplateId('ember');
		expect(store.getPaletteTemplateId()).toBe('ember');
		store.setPaletteTemplateId('not-a-template' as never);
		expect(store.getPaletteTemplateId()).toBe('default');
		store.dispose();
	});

	it('migrates every legacy preset ID and normalizes property strategies', () => {
		const legacy = ['gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
		const expected = ['midnight-blue', 'chestnut', 'pomegranate', 'carrot', 'sun-flower', 'green-sea', 'peter-river', 'wisteria', 'raspberry'];
		const settings = SettingsStore.normalize({
			options: Object.fromEntries(legacy.map((name, index) => [name, {
				propertyId: 'note.status', value: String(index), override: { kind: 'preset', name },
			}])),
			propertyStrategies: {
				'note.tags': { mode: 'single', preset: 'blue' },
				'note.category': { mode: 'neutral' },
				bad: { mode: 'rainbow' },
			},
		});
		expect(Object.values(settings.options).map((option) => option.override?.kind === 'preset' && option.override.name)).toEqual(expected);
		expect(settings.propertyStrategies).toEqual({
			'note.tags': { mode: 'single', preset: 'peter-river' },
			'note.category': { mode: 'neutral' },
		});
	});

	it('resets exact overrides and the property strategy back to Smart', () => {
		const store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.setPropertyStrategy('note.status', { mode: 'single', preset: 'raspberry' });
		store.setOverride({ propertyId: 'note.status', value: 'Done' }, { kind: 'preset', name: 'green-sea' });
		store.resetProperty('note.status');
		expect(store.getExplicitPropertyStrategy('note.status')).toBeUndefined();
		expect(store.get({ propertyId: 'note.status', value: 'Done' })?.override).toBeUndefined();
		store.dispose();
	});

	it('removes only confirmed stale option and property records', () => {
		const store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		store.ensure({ propertyId: 'note.category', value: 'Current' });
		store.ensure({ propertyId: 'note.category', value: 'Deleted' });
		store.setPropertyStrategy('note.category', { mode: 'distinct' });
		store.ensure({ propertyId: 'note.removed', value: 'Old' });
		store.setPropertyStrategy('note.removed', { mode: 'neutral' });

		const removed = store.removeUnusedOptions(
			[
				{ propertyId: 'note.category', value: 'Deleted' },
				{ propertyId: 'note.removed', value: 'Old' },
			],
			['note.removed'],
		);
		expect(removed).toBe(3);
		expect(store.get({ propertyId: 'note.category', value: 'Current' })).toBeDefined();
		expect(store.get({ propertyId: 'note.category', value: 'Deleted' })).toBeUndefined();
		expect(store.getExplicitPropertyStrategy('note.category')).toEqual({ mode: 'distinct' });
		expect(store.getExplicitPropertyStrategy('note.removed')).toBeUndefined();
		store.dispose();
	});

	it('adds, duplicates, reorders, updates, and deletes rules', () => {
		const store = new SettingsStore(SettingsStore.normalize(null), vi.fn(async () => undefined));
		const first = store.addRule('note.status');
		const second = store.addRule('note.priority');
		store.updateRule(first.id, { operand: 'done', target: 'row' });
		store.moveRule(second.id, -1);
		expect(store.settings.rules.map((rule) => rule.id)).toEqual([second.id, first.id]);
		store.duplicateRule(first.id);
		const copy = store.settings.rules[2];
		expect(store.settings.rules).toHaveLength(3);
		expect(store.settings.rules[2]?.name).toContain('copy');
		if (copy) store.moveRuleTo(copy.id, 0);
		expect(store.settings.rules.map((rule) => rule.id)).toEqual([copy?.id, second.id, first.id]);
		if (copy) store.moveRuleTo(copy.id, 99);
		expect(store.settings.rules.map((rule) => rule.id)).toEqual([second.id, first.id, copy?.id]);
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

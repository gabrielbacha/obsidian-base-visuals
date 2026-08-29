import { describe, expect, it, vi } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import { BASE_VISUALS_KEY, BaseVisualStoreRepository, VIEW_VISUALS_KEY } from '../src/core/base-visual-store';
import { SettingsStore } from '../src/core/settings-store';
import { DEFAULT_SETTINGS } from '../src/core/types';
import { encodeOptionKey } from '../src/core/colors';

describe('BaseVisualStoreRepository', () => {
	it('migrates legacy visuals and separates Base-wide and view rules', async () => {
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const values = new Map<string, unknown>();
		const config = {
			get: (key: string) => values.get(key),
			set: vi.fn((key: string, value: unknown) => values.set(key, value)),
		};
		const nativeTable = { type: 'table', containerEl: scope, config };
		const leaf = { view: { containerEl: root, nativeTable } } as unknown as WorkspaceLeaf;
		const app = {
			workspace: {
				getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [],
			},
			vault: { getFileByPath: () => null },
		} as unknown as App;
		const legacy = structuredClone(DEFAULT_SETTINGS);
		const identity = { propertyId: 'note.status', value: 'Done' };
		legacy.options[encodeOptionKey(identity)] = {
			propertyId: 'note.status',
			value: 'Done',
			override: { kind: 'preset', name: 'green-sea' },
		};
		legacy.knownProperties['note.status'] = { propertyId: 'note.status' };
		legacy.rules.push({
			id: 'legacy', name: 'Legacy', enabled: true, propertyId: 'note.status',
			operator: 'equals', operand: 'Done', target: 'cell', scope: 'base',
			color: { kind: 'preset', name: 'green-sea' },
		});
		legacy.propertyStrategies['note.status'] = { mode: 'status' };
		const global = new SettingsStore(legacy, async () => undefined);
		const repository = new BaseVisualStoreRepository(app, global);
		const store = repository.forScope(scope);

		expect(store.get({ propertyId: 'note.status', value: 'Done' })?.override)
			.toEqual({ kind: 'preset', name: 'green-sea' });
		expect(store.getExplicitPropertyStrategy('note.status')).toEqual({ mode: 'status' });
		store.addRule('note.status');
		await store.flush();

		const base = values.get(BASE_VISUALS_KEY) as { rules: Array<{ id: string }>; schemaVersion: number; propertyStrategies: unknown };
		const view = values.get(VIEW_VISUALS_KEY) as { rules: Array<{ scope: string }> };
		expect(base.rules.map((rule) => rule.id)).toEqual(['legacy']);
		expect(base.schemaVersion).toBe(3);
		expect(base.propertyStrategies).toEqual({ 'note.status': { mode: 'status' } });
		expect(view.rules).toHaveLength(1);
		expect(view.rules[0]?.scope).toBe('view');
		await repository.dispose();
		root.remove();
	});

	it('stores shared column appearance in the Base record', () => {
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const values = new Map<string, unknown>();
		const nativeTable = {
			type: 'table', containerEl: scope,
			config: { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value) },
		};
		const leaf = { view: { containerEl: root, nativeTable } } as unknown as WorkspaceLeaf;
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
			vault: { getFileByPath: () => null },
		} as unknown as App;
		const global = new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined);
		const repository = new BaseVisualStoreRepository(app, global);

		expect(repository.setBaseColumnAppearance(scope, 'note.priority', { tone: 'muted', bold: true })).toBe(true);
		expect(repository.getBaseColumnAppearances(scope)).toEqual({
			'note.priority': { tone: 'muted', bold: true },
		});
		root.remove();
	});
});

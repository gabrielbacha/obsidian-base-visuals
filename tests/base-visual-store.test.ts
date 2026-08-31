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
		expect(base.schemaVersion).toBe(6);
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

	it('scopes list properties to the current base and migrates display aliases', async () => {
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const table = scope.createDiv('bases-table-container');
		const header = table.createDiv('bases-thead').createDiv('bases-td');
		header.dataset.property = 'Status';
		const values = new Map<string, unknown>();
		const aliasIdentity = { propertyId: 'note.Status', value: 'Done' };
		values.set(BASE_VISUALS_KEY, {
			schemaVersion: 3,
			options: {
				[encodeOptionKey(aliasIdentity)]: {
					...aliasIdentity, override: { kind: 'preset', name: 'green-sea' },
				},
			},
			knownProperties: { 'note.Status': { propertyId: 'note.Status' } },
			rules: [{
				id: 'alias-rule', name: 'Alias', enabled: true, propertyId: 'note.Status',
				operator: 'equals', operand: 'Done', target: 'cell', scope: 'base',
				color: { kind: 'preset', name: 'green-sea' },
			}],
			propertyStrategies: { 'note.Status': { mode: 'status', style: 'solid' } },
		});
		const config = {
			get: (key: string) => values.get(key),
			set: vi.fn((key: string, value: unknown) => values.set(key, value)),
			getOrder: () => ['Status'],
			getDisplayName: (propertyId: string) => propertyId === 'note.status_todo' ? 'Status' : propertyId,
		};
		const baseFile = { path: 'project.base', extension: 'base' };
		const nativeTable = {
			type: 'table', containerEl: table, config,
			path: 'project.base',
			data: { properties: ['note.Status'], data: [] },
			header: { cells: [{ prop: 'Status', el: header }] },
		};
		const leaf = { view: { containerEl: root, nativeTable } } as unknown as WorkspaceLeaf;
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
			vault: {
				getFileByPath: (path: string) => path === 'project.base' ? baseFile : null,
				cachedRead: async () => JSON.stringify({
					properties: {
						status_todo: { type: 'select', displayName: 'Status' },
						other: { type: 'text' },
					},
					views: [{ type: 'table', order: ['Status', 'other'] }],
				}),
			},
		} as unknown as App;
		const globalSettings = structuredClone(DEFAULT_SETTINGS);
		globalSettings.options[encodeOptionKey({ propertyId: 'note.unrelated', value: 'Old' })] = {
			propertyId: 'note.unrelated', value: 'Old',
		};
		const global = new SettingsStore(globalSettings, async () => undefined);
		const repository = new BaseVisualStoreRepository(app, global);
		const store = repository.forScope(scope);

		const propertyIds = await repository.propertyIdsForScope(scope, ['note.Status']);
		await Promise.resolve();
		expect(propertyIds).toEqual(new Set(['note.status_todo']));
		expect(repository.resolvePropertyId(scope, 'note.Status')).toBe('note.status_todo');
		expect(store.get({ propertyId: 'note.status_todo', value: 'Done' })?.override)
			.toEqual({ kind: 'preset', name: 'green-sea' });
		expect(store.getExplicitPropertyStrategy('note.status_todo'))
			.toEqual({ mode: 'status', style: 'solid' });
		expect(store.settings.rules[0]?.propertyId).toBe('note.status_todo');
		expect(store.get({ propertyId: 'note.Status', value: 'Done' })).toBeUndefined();
		await repository.dispose();
		root.remove();
	});

	it('merges rapid pill-style edits from separate live views of the same Base', async () => {
		const roots = [document.body.createDiv(), document.body.createDiv()];
		const scopes = roots.map((root) => root.createDiv('bases-view'));
		const initialBase = {
			schemaVersion: 6,
			paletteTemplateId: 'default',
			options: {}, knownProperties: {}, rules: [], propertyStrategies: {},
		};
		const values = [new Map<string, unknown>(), new Map<string, unknown>()];
		for (const map of values) map.set(BASE_VISUALS_KEY, structuredClone(initialBase));
		const configs = values.map((map) => ({
			get: (key: string) => map.get(key),
			set: vi.fn((key: string, value: unknown) => map.set(key, value)),
			getOrder: () => ['note.priority_todo', 'note.workstream_todo'],
			getDisplayName: (propertyId: string) => propertyId === 'note.priority_todo'
				? 'Priority'
				: propertyId === 'note.workstream_todo' ? 'Workstream' : propertyId,
		}));
		const baseFile = { path: 'todos.base', extension: 'base' };
		const tables = scopes.map((scope, index) => ({
			type: 'table', containerEl: scope, config: configs[index],
			path: 'todos.base',
			data: { properties: ['note.priority_todo', 'note.workstream_todo'], data: [] },
		}));
		const leaves = roots.map((root, index) => ({
			view: { containerEl: root, nativeTable: tables[index] },
		})) as unknown as WorkspaceLeaf[];
		let source = JSON.stringify({
			properties: {
				'note.priority_todo': { type: 'select', displayName: 'Priority' },
				'note.workstream_todo': { type: 'select', displayName: 'Workstream' },
			},
			views: [
				{ type: 'table', basesVisualsBase: structuredClone(initialBase) },
				{ type: 'table', basesVisualsBase: structuredClone(initialBase) },
			],
		});
		const process = vi.fn(async (
			_file: unknown,
			update: (current: string) => string,
		) => { source = update(source); });
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? leaves : [] },
			vault: {
				getFileByPath: (path: string) => path === 'todos.base' ? baseFile : null,
				cachedRead: async () => source,
				process,
			},
		} as unknown as App;
		const global = new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined);
		const repository = new BaseVisualStoreRepository(app, global);
		const priorityView = repository.forScope(scopes[0]!);
		const workstreamView = repository.forScope(scopes[1]!);

		priorityView.setPropertyStyle('note.priority_todo', 'solid');
		workstreamView.setPropertyStyle('note.workstream_todo', 'outline');
		await Promise.all([priorityView.flush(), workstreamView.flush()]);

		for (const store of [priorityView, workstreamView]) {
			expect(store.getPropertyStyle('note.priority_todo')).toBe('solid');
			expect(store.getPropertyStyle('note.workstream_todo')).toBe('outline');
		}
		for (const map of values) {
			expect((map.get(BASE_VISUALS_KEY) as { propertyStrategies: unknown }).propertyStrategies)
				.toEqual({
					'note.priority_todo': { mode: 'smart', style: 'solid' },
					'note.workstream_todo': { mode: 'smart', style: 'outline' },
				});
		}
		const persisted = JSON.parse(source) as {
			views: Array<{ basesVisualsBase: { propertyStrategies: unknown } }>;
		};
		for (const view of persisted.views) {
			expect(view.basesVisualsBase.propertyStrategies).toEqual({
				'note.priority_todo': { mode: 'smart', style: 'solid' },
				'note.workstream_todo': { mode: 'smart', style: 'outline' },
			});
		}

		await repository.dispose();
		for (const root of roots) root.remove();
	});

	it('preserves a local style change made while sibling Base data is hydrating', async () => {
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const values = new Map<string, unknown>();
		const config = {
			get: (key: string) => values.get(key),
			set: (key: string, value: unknown) => values.set(key, value),
			getOrder: () => ['note.priority_todo', 'note.workstream_todo'],
		};
		const baseFile = { path: 'hydrating.base', extension: 'base' };
		const nativeTable = {
			type: 'table', containerEl: scope, config, path: 'hydrating.base',
			data: { properties: ['note.priority_todo', 'note.workstream_todo'], data: [] },
		};
		const leaf = { view: { containerEl: root, nativeTable } } as unknown as WorkspaceLeaf;
		let resolveRead: ((source: string) => void) | undefined;
		const read = new Promise<string>((resolve) => { resolveRead = resolve; });
		let source = JSON.stringify({
			properties: {
				'note.priority_todo': { type: 'select', displayName: 'Priority' },
				'note.workstream_todo': { type: 'select', displayName: 'Workstream' },
			},
			views: [{
				type: 'table',
				basesVisualsBase: {
					schemaVersion: 6, paletteTemplateId: 'default', options: {},
					knownProperties: {}, rules: [],
					propertyStrategies: {
						'note.workstream_todo': { mode: 'smart', style: 'outline' },
					},
				},
			}],
		});
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
			vault: {
				getFileByPath: (path: string) => path === 'hydrating.base' ? baseFile : null,
				cachedRead: () => read,
				process: async (_file: unknown, update: (current: string) => string) => {
					source = update(source);
				},
			},
		} as unknown as App;
		const global = new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined);
		const repository = new BaseVisualStoreRepository(app, global);
		const store = repository.forScope(scope);

		store.setPropertyStyle('note.priority_todo', 'solid');
		resolveRead?.(source);
		await read;
		await vi.waitFor(() => {
			expect(store.getPropertyStyle('note.workstream_todo')).toBe('outline');
		});
		await store.flush();

		expect(store.getPropertyStyle('note.priority_todo')).toBe('solid');
		expect(store.getPropertyStyle('note.workstream_todo')).toBe('outline');
		const persisted = JSON.parse(source) as {
			views: Array<{ basesVisualsBase: { propertyStrategies: unknown } }>;
		};
		expect(persisted.views[0]?.basesVisualsBase.propertyStrategies).toEqual({
			'note.workstream_todo': { mode: 'smart', style: 'outline' },
			'note.priority_todo': { mode: 'smart', style: 'solid' },
		});

		await repository.dispose();
		root.remove();
	});
});

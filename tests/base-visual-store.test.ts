import { describe, expect, it, vi } from 'vitest';
import { Notice, type App, type WorkspaceLeaf } from 'obsidian';
import { BaseVisualStoreRepository } from '../src/core/base-visual-store';
import { SettingsStore } from '../src/core/settings-store';
import { DEFAULT_SETTINGS } from '../src/core/types';
import {
	encodeOptionKey,
	LEGACY_BASE_VISUALS_KEY,
	LEGACY_VIEW_COLUMN_APPEARANCE_KEY as COLUMN_APPEARANCE_CONFIG_KEY,
	LEGACY_VISUALS_KEY as BASE_VISUALS_KEY,
	LEGACY_VISUALS_VIEW_KEY as VIEW_VISUALS_KEY,
	STUDIO_KEY,
} from '@gabrielbacha/bases-contract';

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
		(legacy.rules as unknown as Array<Record<string, unknown>>).push({
			id: 'legacy', name: 'Legacy', enabled: true, propertyId: 'note.status',
			operator: 'equals', operand: 'Done', target: 'row', scope: 'base',
			color: { kind: 'preset', name: 'green-sea' }, backgroundOpacity: 38,
			rowHeight: 'collapsed',
		});
		legacy.propertyStrategies['note.status'] = { mode: 'status' };
		values.set(LEGACY_BASE_VISUALS_KEY, legacy);
		const global = new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined);
		const repository = new BaseVisualStoreRepository(app, global);
		const store = repository.forScope(scope);

		expect(store.get({ propertyId: 'note.status', value: 'Done' })?.override)
			.toEqual({ kind: 'preset', name: 'green-sea' });
		expect(store.getExplicitPropertyStrategy('note.status')).toEqual({ mode: 'status' });
		store.addRule('note.status');
		await store.flush();

		// The view's rule is saved in the view's block; where it is saved gives its scope.
		const view = values.get(STUDIO_KEY) as { rules: Array<Record<string, unknown>> };
		expect(view.rules).toHaveLength(1);
		expect(view.rules[0]).not.toHaveProperty('scope');
		expect(store.settings.rules.filter((rule) => rule.scope === 'view')).toHaveLength(1);
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

	it('keeps the scoped settings store authoritative when Obsidian replaces the native view config', async () => {
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const firstValues = new Map<string, unknown>();
		const secondValues = new Map<string, unknown>();
		const createConfig = (values: Map<string, unknown>) => ({
			get: (key: string) => values.get(key),
			set: vi.fn((key: string, value: unknown) => values.set(key, value)),
		});
		const nativeTable: {
			type: string;
			containerEl: HTMLElement;
			config: ReturnType<typeof createConfig>;
		} = { type: 'table', containerEl: scope, config: createConfig(firstValues) };
		const leaf = { view: { containerEl: root, nativeTable } } as unknown as WorkspaceLeaf;
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
			vault: { getFileByPath: () => null },
		} as unknown as App;
		const global = new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined);
		const repository = new BaseVisualStoreRepository(app, global);
		const store = repository.forScope(scope);

		store.setPropertyStyle('note.status', 'solid');
		await store.flush();
		nativeTable.config = createConfig(secondValues);
		const rebound = repository.forScope(scope);

		expect(rebound).toBe(store);
		expect(rebound.getPropertyStyle('note.status')).toBe('solid');
		expect(secondValues.has(BASE_VISUALS_KEY)).toBe(false);
		await repository.dispose();
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
		values.set(LEGACY_BASE_VISUALS_KEY, {
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
		const rulePropertyIds = await repository.rulePropertyIdsForScope(scope, ['note.Status']);
		await Promise.resolve();
		expect(propertyIds).toEqual(new Set(['note.status_todo']));
		expect(rulePropertyIds).toEqual(new Set(['note.status_todo', 'note.other']));
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
		for (const map of values) map.set(LEGACY_BASE_VISUALS_KEY, structuredClone(initialBase));
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
		const persisted = JSON.parse(source) as {
			basesStudio: { version: number; properties: unknown };
			views: Array<Record<string, unknown>>;
		};
		expect(persisted.basesStudio.version).toBe(1);
		expect(persisted.basesStudio.properties).toEqual({
			'note.priority_todo': { pills: { style: 'solid' } },
			'note.workstream_todo': { pills: { style: 'outline' } },
		});
		expect(persisted.views.every((view) => !(LEGACY_BASE_VISUALS_KEY in view))).toBe(true);

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
			basesStudio: { properties: unknown };
			views: Array<Record<string, unknown>>;
		};
		expect(persisted.basesStudio.properties).toEqual({
			'note.workstream_todo': { pills: { style: 'outline' } },
			'note.priority_todo': { pills: { style: 'solid' } },
		});
		expect(persisted.views[0]).not.toHaveProperty(LEGACY_BASE_VISUALS_KEY);

		await repository.dispose();
		root.remove();
	});

	it('does not migrate legacy data merely by opening a Base', async () => {
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const values = new Map<string, unknown>();
		values.set(LEGACY_BASE_VISUALS_KEY, {
			schemaVersion: 6, propertyStrategies: { 'note.status': { mode: 'status' } },
		});
		const config = { get: (key: string) => values.get(key), set: vi.fn() };
		const baseFile = { path: 'passive.base', extension: 'base' };
		const leaf = { view: { containerEl: root, nativeTable: {
			type: 'table', containerEl: scope, config, path: baseFile.path,
		} } } as unknown as WorkspaceLeaf;
		const process = vi.fn();
		const app = {
			workspace: { getLeavesOfType: () => [leaf] },
			vault: {
				getFileByPath: () => baseFile,
				cachedRead: async () => JSON.stringify({
					views: [{ type: 'table', basesVisualsBase: values.get(LEGACY_BASE_VISUALS_KEY) }],
				}),
				process,
			},
		} as unknown as App;
		const repository = new BaseVisualStoreRepository(
			app,
			new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined),
		);
		repository.forScope(scope);
		await vi.waitFor(() => {
			expect(repository.resolvePropertyId(scope, 'note.status')).toBe('note.status');
		});
		expect(process).not.toHaveBeenCalled();
		await repository.dispose();
		root.remove();
	});

	it('preserves unknown view data when saving recognized view rules', async () => {
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const values = new Map<string, unknown>();
		values.set(VIEW_VISUALS_KEY, {
			schemaVersion: 3,
			futureViewField: { layout: 'detail' },
			rules: [{
				id: 'view-rule', name: 'View rule', enabled: true, propertyId: 'note.status',
				operator: 'equals', operand: 'Done', target: 'cell', scope: 'view',
				futureRuleField: 'keep',
			}],
		});
		const config = {
			get: (key: string) => values.get(key),
			set: (key: string, value: unknown) => values.set(key, value),
		};
		const leaf = { view: { containerEl: root, nativeTable: { type: 'table', containerEl: scope, config } } } as unknown as WorkspaceLeaf;
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
			vault: { getFileByPath: () => null },
		} as unknown as App;
		const repository = new BaseVisualStoreRepository(
			app,
			new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined),
		);
		const store = repository.forScope(scope);

		store.setPropertyStyle('note.status', 'solid');
		await store.flush();
		// The old view block moved into basesStudio, with what this version does not know.
		const persisted = values.get(STUDIO_KEY) as {
			futureViewField: unknown;
			rules: Array<Record<string, unknown>>;
		};
		expect(values.get(VIEW_VISUALS_KEY)).toBeNull();
		expect(persisted.futureViewField).toEqual({ layout: 'detail' });
		expect(persisted.rules[0]?.futureRuleField).toBe('keep');

		await repository.dispose();
		root.remove();
	});

	it('never rewrites a view block saved by a newer version', async () => {
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const values = new Map<string, unknown>();
		const newer = {
			schemaVersion: 9,
			rules: [{
				id: 'view-rule', name: 'View rule', enabled: true, propertyId: 'note.status',
				operator: 'equals', operand: 'Done', target: 'cell', scope: 'view',
			}],
		};
		values.set(VIEW_VISUALS_KEY, structuredClone(newer));
		const config = {
			get: (key: string) => values.get(key),
			set: (key: string, value: unknown) => values.set(key, value),
		};
		const leaf = { view: { containerEl: root, nativeTable: { type: 'table', containerEl: scope, config } } } as unknown as WorkspaceLeaf;
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
			vault: { getFileByPath: () => null },
		} as unknown as App;
		const repository = new BaseVisualStoreRepository(
			app,
			new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined),
		);
		const store = repository.forScope(scope);

		store.updateRule('view-rule', { enabled: false });
		await store.flush();
		expect(values.get(VIEW_VISUALS_KEY)).toEqual(newer);
		expect(values.get(STUDIO_KEY)).toBeUndefined();
		expect(repository.getPersistenceState(scope)).toEqual({
			status: 'read-only',
			reason: 'basesVisualsView was saved by a newer version',
		});

		await repository.dispose();
		root.remove();
	});

	it('moves a legacy view appearance into basesStudio on an intentional edit', async () => {
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const values = new Map<string, unknown>();
		values.set(COLUMN_APPEARANCE_CONFIG_KEY, {
			'note.status': { tone: 'muted', bold: false },
		});
		const config = {
			get: (key: string) => values.get(key),
			set: (key: string, value: unknown) => values.set(key, value),
		};
		const baseFile = { path: 'view-v2.base', extension: 'base' };
		const leaf = { view: { containerEl: root, nativeTable: {
			type: 'table', containerEl: scope, config, path: baseFile.path,
		} } } as unknown as WorkspaceLeaf;
		let source = JSON.stringify({
			views: [{
				type: 'table',
				[COLUMN_APPEARANCE_CONFIG_KEY]: values.get(COLUMN_APPEARANCE_CONFIG_KEY),
			}],
		});
		const app = {
			workspace: { getLeavesOfType: () => [leaf] },
			vault: {
				getFileByPath: () => baseFile,
				cachedRead: async () => source,
				process: async (_file: unknown, update: (current: string) => string) => {
					source = update(source);
				},
			},
		} as unknown as App;
		const repository = new BaseVisualStoreRepository(
			app,
			new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined),
		);
		repository.forScope(scope);
		repository.setViewColumnAppearance(scope, 'note.status', { tone: 'faint', bold: true });
		await vi.waitFor(() => {
			const parsed = JSON.parse(source) as { views: Array<Record<string, unknown>> };
			expect(parsed.views[0]?.[STUDIO_KEY]).toEqual({
				columns: { 'note.status': { style: { tone: 'faint', bold: true } } },
			});
			expect(parsed.views[0]).not.toHaveProperty(COLUMN_APPEARANCE_CONFIG_KEY);
		});
		await repository.dispose();
		root.remove();
	});

	it('does not prune temporarily missing properties during passive loading or later saves', async () => {
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const values = new Map<string, unknown>();
		const config = {
			get: (key: string) => values.get(key),
			set: (key: string, value: unknown) => values.set(key, value),
			getOrder: () => ['note.current'],
		};
		const baseFile = { path: 'missing-property.base', extension: 'base' };
		const nativeTable = {
			type: 'table', containerEl: scope, config, path: baseFile.path,
			data: { properties: ['note.current'], data: [] },
		};
		const leaf = { view: { containerEl: root, nativeTable } } as unknown as WorkspaceLeaf;
		let source = JSON.stringify({
			properties: { current: { type: 'select' } },
			basesVisuals: {
				schemaVersion: 7,
				propertyStrategies: { 'note.temporarily_missing': { mode: 'status', style: 'outline' } },
			},
			views: [],
		});
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
			vault: {
				getFileByPath: (path: string) => path === baseFile.path ? baseFile : null,
				cachedRead: async () => source,
				process: async (_file: unknown, update: (current: string) => string) => {
					source = update(source);
				},
			},
		} as unknown as App;
		const repository = new BaseVisualStoreRepository(
			app,
			new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined),
		);
		const store = repository.forScope(scope);
		await vi.waitFor(() => {
			expect(store.getPropertyStyle('note.temporarily_missing')).toBe('outline');
		});

		store.setPropertyStyle('note.current', 'solid');
		await store.flush();
		const properties = (JSON.parse(source) as {
			basesStudio: { properties: Record<string, unknown> };
		}).basesStudio.properties;
		expect(properties['note.temporarily_missing']).toEqual({ pills: { mode: 'status', style: 'outline' } });
		expect(properties['note.current']).toEqual({ pills: { style: 'solid' } });

		await repository.dispose();
		root.remove();
	});

	it('refuses and reports incompatible edits to the same setting', async () => {
		const noticeMessages = (Notice as unknown as { messages: string[] }).messages;
		noticeMessages.length = 0;
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const values = new Map<string, unknown>();
		const config = {
			get: (key: string) => values.get(key),
			set: (key: string, value: unknown) => values.set(key, value),
		};
		const baseFile = { path: 'conflict.base', extension: 'base' };
		const nativeTable = { type: 'table', containerEl: scope, config, path: baseFile.path };
		const leaf = { view: { containerEl: root, nativeTable } } as unknown as WorkspaceLeaf;
		let source = JSON.stringify({
			basesVisuals: {
				schemaVersion: 7,
				propertyStrategies: { 'note.status': { mode: 'status' } },
			},
			views: [],
		});
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
			vault: {
				getFileByPath: (path: string) => path === baseFile.path ? baseFile : null,
				cachedRead: async () => source,
				process: async (_file: unknown, update: (current: string) => string) => {
					source = update(source);
				},
			},
		} as unknown as App;
		const repository = new BaseVisualStoreRepository(
			app,
			new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined),
		);
		const store = repository.forScope(scope);
		await vi.waitFor(() => {
			expect(store.getExplicitPropertyStrategy('note.status')).toEqual({ mode: 'status' });
		});
		// Another app moves the Base into basesStudio and makes the pills solid.
		source = JSON.stringify({
			basesStudio: { version: 1, properties: { 'note.status': { pills: { mode: 'status', style: 'solid' } } } },
			views: [],
		});

		store.setPropertyStyle('note.status', 'outline');
		await store.flush();
		const persisted = JSON.parse(source) as {
			basesStudio: { properties: Record<string, { pills?: { style?: string } }> };
		};
		expect(persisted.basesStudio.properties['note.status']?.pills?.style).toBe('solid');
		expect(noticeMessages.at(-1)).toContain('conflicting changes in properties.note.status.pills.style');

		await repository.dispose();
		root.remove();
	});

	it('shows persistence failures instead of silently implying a save succeeded', async () => {
		const noticeMessages = (Notice as unknown as { messages: string[] }).messages;
		noticeMessages.length = 0;
		const root = document.body.createDiv();
		const scope = root.createDiv('bases-view');
		const values = new Map<string, unknown>();
		const config = {
			get: (key: string) => values.get(key),
			set: (key: string, value: unknown) => values.set(key, value),
		};
		const baseFile = { path: 'read-only.base', extension: 'base' };
		const nativeTable = { type: 'table', containerEl: scope, config, path: baseFile.path };
		const leaf = { view: { containerEl: root, nativeTable } } as unknown as WorkspaceLeaf;
		const app = {
			workspace: { getLeavesOfType: (type: string) => type === 'bases' ? [leaf] : [] },
			vault: {
				getFileByPath: (path: string) => path === baseFile.path ? baseFile : null,
				cachedRead: async () => JSON.stringify({ views: [] }),
				process: async () => { throw new Error('read only'); },
			},
		} as unknown as App;
		const repository = new BaseVisualStoreRepository(
			app,
			new SettingsStore(structuredClone(DEFAULT_SETTINGS), async () => undefined),
		);
		const store = repository.forScope(scope);

		store.setPropertyStyle('note.status', 'solid');
		await store.flush();
		expect(noticeMessages.at(-1)).toContain('could not save read-only.base: read only');

		await repository.dispose();
		root.remove();
	});
});

import type { App, PluginManifest } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (original) => ({
	...await original<typeof import('obsidian')>(),
	Plugin: class {
		loadData = vi.fn(async (): Promise<unknown> => null);
		saveData = vi.fn(async () => undefined);
	},
}));
vi.mock('../src/core/pill-enhancer', () => ({ PillEnhancer: class {} }));
vi.mock('../src/core/base-visual-store', () => ({ BaseVisualStoreRepository: class {} }));
vi.mock('../src/ui/color-popover', () => ({ ColorPopover: class {} }));
vi.mock('../src/ui/column-pill-popover', () => ({ ColumnPillPopover: class {} }));
vi.mock('../src/ui/settings-tab', () => ({ BasesPillColorsSettingTab: class {} }));
vi.mock('../src/ui/visuals-manager', () => ({ BasesVisualsModal: class {} }));

import BasesPillColorsPlugin from '../src/main';
import { Notice } from 'obsidian';

describe('global settings startup', () => {
	it('never writes or starts the enhancer when a newer version owns the settings', async () => {
		const plugin = new BasesPillColorsPlugin({} as App, {} as PluginManifest);
		const raw = { schemaVersion: 999, unknown: { exact: true }, rules: [{ operator: 'future' }] };
		const before = JSON.stringify(raw);
		vi.spyOn(plugin, 'loadData').mockResolvedValue(raw);
		const save = vi.spyOn(plugin, 'saveData');
		await plugin.onload();
		expect(save).not.toHaveBeenCalled();
		expect(JSON.stringify(raw)).toBe(before);
		expect((Notice as unknown as { messages: string[] }).messages.at(-1)).toContain('newer plugin');
		plugin.onunload();
		await plugin.finishSettingsWrites();
		expect(save).not.toHaveBeenCalled();
	});
});

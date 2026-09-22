import { describe, expect, it } from 'vitest';
import { patchYamlMap, readYamlMap } from '../src/core/yaml-patch';

describe('source-aware YAML patches', () => {
	it('distinguishes absent, malformed blocks, and malformed documents', () => {
		expect(readYamlMap('views: []\n', ['basesVisuals']).status).toBe('absent');
		expect(readYamlMap('basesVisuals: [future]\n', ['basesVisuals']).status).toBe('block-invalid');
		expect(readYamlMap('basesVisuals: [\n', ['basesVisuals']).status).toBe('document-invalid');
	});

	it('preserves quoted keys, trailing comments, nested comments, and unrelated source', () => {
		const source = [
			'# before',
			'filters: []',
			'"basesVisuals": # header',
			'  schemaVersion: 7 # version',
			'  future: { desktop: true } # unknown',
			'  propertyStrategies:',
			'    note.status:',
			'      mode: status # mode',
			'views: [] # after',
			'',
		].join('\n');
		const result = patchYamlMap(source, ['basesVisuals'], {
			schemaVersion: 8,
			future: { desktop: true },
			propertyStrategies: { 'note.status': { mode: 'status', style: 'solid' } },
		});
		expect(result.status).toBe('patched');
		expect(result.source).toContain('"basesVisuals": # header');
		expect(result.source).toContain('schemaVersion: 8 # version');
		expect(result.source).toContain('future: { desktop: true } # unknown');
		expect(result.source).toContain('mode: status # mode');
		expect(result.source.endsWith('views: [] # after\n')).toBe(true);
	});

	it('patches JSON values without rewriting unrelated JSON text', () => {
		const source = '{ "foreign" : { "spacing": true }, "basesVisuals": {"schemaVersion":7}, "views": [] }';
		const result = patchYamlMap(source, ['basesVisuals'], { schemaVersion: 8, future: true });
		expect(result.status).toBe('patched');
		expect(result.source.startsWith('{ "foreign" : { "spacing": true }, "basesVisuals": ')).toBe(true);
		const parsed = JSON.parse(result.source) as { basesVisuals: unknown };
		expect(parsed.basesVisuals).toEqual({ schemaVersion: 8, future: true });
	});

	it('keeps nested view patches valid and separated from following keys', () => {
		const source = [
			'views:',
			'  - type: table',
			'    basesVisualsView:',
			'      schemaVersion: 1',
			'      rules: []',
			'    basesVisualsDateFormats:',
			'      note.date: YYYY-MM-DD',
			'',
		].join('\n');
		const result = patchYamlMap(source, ['views', 0, 'basesVisualsView'], {
			schemaVersion: 2,
			rules: [],
			columnAppearances: { 'note.status': { bold: true } },
		});

		expect(result.status).toBe('patched');
		expect(readYamlMap(result.source, ['views', 0, 'basesVisualsView']).status).toBe('present');
		expect(readYamlMap(result.source, ['views', 0, 'basesVisualsDateFormats']).status).toBe('present');
	});
});

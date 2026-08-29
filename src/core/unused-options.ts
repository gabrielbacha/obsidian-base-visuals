import type { App } from 'obsidian';
import { getNativeResultPropertyValues } from './native-table-view';
import type { OptionIdentity } from './types';

export interface UnusedOptionsPlan {
	options: OptionIdentity[];
	removedProperties: string[];
	verifiedProperties: number;
}

export function findUnusedOptions(
	app: App,
	scope: HTMLElement,
	options: readonly OptionIdentity[],
	knownPropertyIds: readonly string[] = [],
): UnusedOptionsPlan {
	const propertyIds = [...new Set([...options.map((option) => option.propertyId), ...knownPropertyIds])];
	const used = new Map<string, Set<string>>();
	const existing = new Set<string>();
	const verified = new Set<string>();

	const noteProperties = propertyIds.filter((propertyId) => propertyId.startsWith('note.'));
	for (const propertyId of noteProperties) {
		used.set(propertyId, new Set());
		verified.add(propertyId);
	}
	for (const file of app.vault.getMarkdownFiles()) {
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) continue;
		for (const propertyId of noteProperties) {
			const propertyName = propertyId.slice('note.'.length);
			if (!Object.prototype.hasOwnProperty.call(frontmatter, propertyName)) continue;
			existing.add(propertyId);
			for (const value of rawValueTexts(frontmatter[propertyName])) used.get(propertyId)?.add(value);
		}
	}

	const resultProperties = propertyIds.filter((propertyId) => !propertyId.startsWith('note.'));
	const native = getNativeResultPropertyValues(app, scope, resultProperties);
	if (native.available) {
		for (const propertyId of resultProperties) {
			verified.add(propertyId);
			used.set(propertyId, native.values.get(propertyId) ?? new Set());
			if (native.properties.has(propertyId)) existing.add(propertyId);
		}
	}

	return {
		options: options.filter((option) =>
			verified.has(option.propertyId) && !used.get(option.propertyId)?.has(option.value)),
		removedProperties: [...verified].filter((propertyId) => !existing.has(propertyId)),
		verifiedProperties: verified.size,
	};
}

function rawValueTexts(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(rawValueTexts);
	if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
	if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
	return [];
}

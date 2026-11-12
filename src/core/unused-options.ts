import type { App } from 'obsidian';
import type { OptionIdentity } from './types';

export interface UnusedOptionsPlan {
	options: OptionIdentity[];
	removedProperties: string[];
	verifiedProperties: number;
	scope?: string;
	reason?: string;
}
/** A vault-wide superset protects values hidden by any Base/view filter. Never infer removal from one result. */
export function findUnusedOptions(
	app: App,
	_scope: HTMLElement,
	options: readonly OptionIdentity[],
	knownPropertyIds: readonly string[] = [],
	declared: Readonly<Record<string, readonly {value: string}[]>> = {},
): UnusedOptionsPlan {
	const empty = (reason: string): UnusedOptionsPlan => ({options: [], removedProperties: [], verifiedProperties: 0, reason});
	if (!app.vault?.getMarkdownFiles || !app.metadataCache?.getFileCache) return empty('Vault note properties are not available to verify.');
	const propertyIds = [...new Set([...options.map(option => option.propertyId), ...knownPropertyIds])].filter(id => id.startsWith('note.'));
	const used = new Map(propertyIds.map(id => [id, new Set<string>()]));
	const verified = new Set(propertyIds);
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) return empty('Some notes are not indexed yet. No saved settings were removed. Retry after indexing.');
		for (const propertyId of propertyIds) {
			const raw: unknown = cache.frontmatter?.[propertyId.slice(5)];
			for (const value of Array.isArray(raw) ? raw : [raw]) {
				if (value === null || value === undefined) continue;
				if (['string', 'number', 'boolean'].includes(typeof value)) used.get(propertyId)?.add(String(value));
				else verified.delete(propertyId);
			}
		}
	}
	return {
		options: options.filter(option => verified.has(option.propertyId) && !used.get(option.propertyId)?.has(option.value) && !declared[option.propertyId]?.some(item => item.value === option.value)),
		// A temporarily absent property is not proof its saved strategy is obsolete.
		removedProperties: [],
		verifiedProperties: verified.size,
		scope: 'All indexed Markdown note properties in this vault. Declared options and uncertain properties are kept.',
	};
}

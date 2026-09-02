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

	const native = getNativeResultPropertyValues(app, scope, propertyIds);
	if (native.available) {
		for (const propertyId of propertyIds) {
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

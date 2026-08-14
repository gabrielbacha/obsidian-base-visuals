import type { App, WorkspaceLeaf } from 'obsidian';
import { normalizeHex } from './colors';

export const ROW_HEIGHTS = [
	{ value: '', label: 'Short' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'tall', label: 'Tall' },
	{ value: 'extra', label: 'Extra tall' },
] as const;

export type NativeRowHeight = (typeof ROW_HEIGHTS)[number]['value'];

export const COLUMN_WIDTH_PRESETS = [
	{ width: 100, label: 'Compact' },
	{ width: 160, label: 'Standard' },
	{ width: 240, label: 'Wide' },
	{ width: 300, label: 'Maximum' },
] as const;

export type ColumnWidthScope = 'unset' | 'all';

export type ColumnTextTone = 'default' | 'muted' | 'faint' | 'custom';

export interface NativeColumnAppearance {
	tone: ColumnTextTone;
	bold: boolean;
	color?: string;
}

export const DEFAULT_COLUMN_APPEARANCE: NativeColumnAppearance = {
	tone: 'default',
	bold: false,
};

const COLUMN_APPEARANCE_CONFIG_KEY = 'basesVisualsColumnAppearance';

interface NativeViewConfig {
	groupBy?: { property?: unknown };
	get(key: string): unknown;
	set(key: string, value: unknown): void;
	getOrder?(): unknown[];
}

interface NativeTableView {
	type: string;
	containerEl: HTMLElement;
	config: NativeViewConfig;
	data?: { properties?: unknown[] };
	columnInfo?: Record<string, NativeColumnInfo>;
	minColWidth?: number;
	maxColWidth?: number;
	updateVirtualDisplay?: () => void;
	saveColumnSizes?: () => void;
	header?: { cells?: NativeHeaderCell[] };
}

interface NativeHeaderCell {
	prop: string;
	el: HTMLElement;
}

export interface NativeColumnHeader {
	propertyId: string;
	element: HTMLElement;
}

interface NativeColumnInfo {
	headerWidth: number;
	contentWidth: number;
	customWidth: number;
}

const VIEW_CACHE = new WeakMap<HTMLElement, NativeTableView>();

export function getNativeRowHeight(app: App, scope: HTMLElement): NativeRowHeight {
	const value = findNativeTableView(app, scope)?.config.get('rowHeight');
	return ROW_HEIGHTS.some((option) => option.value === value) ? value as NativeRowHeight : '';
}

export function setNativeRowHeight(
	app: App,
	scope: HTMLElement,
	value: NativeRowHeight,
): boolean {
	const view = findNativeTableView(app, scope);
	if (!view) return false;
	view.config.set('rowHeight', value || null);
	return true;
}

export function resetNativeColumnWidths(app: App, scope: HTMLElement): boolean {
	const view = findNativeTableView(app, scope);
	const properties = nativeProperties(view);
	if (!view?.columnInfo || !view.updateVirtualDisplay || properties.length === 0) return false;
	for (const property of properties) {
		const info = view.columnInfo[property];
		if (!info) continue;
		info.customWidth = 0;
		info.contentWidth = 0;
	}
	view.updateVirtualDisplay();
	if (view.saveColumnSizes) view.saveColumnSizes();
	else view.config.set('columnSize', null);
	return true;
}

export function applyNativeColumnWidthPreset(
	app: App,
	scope: HTMLElement,
	requestedWidth: number,
	applyTo: ColumnWidthScope,
	initiallyUnset?: ReadonlySet<string>,
): boolean {
	const view = findNativeTableView(app, scope);
	const properties = nativeProperties(view);
	if (!view?.columnInfo || !view.updateVirtualDisplay || properties.length === 0) return false;
	const min = finiteOr(view.minColWidth, cssNumber(view.containerEl, '--bases-table-column-min-width', 40));
	const max = finiteOr(view.maxColWidth, cssNumber(view.containerEl, '--bases-table-column-max-width', 300));
	const width = Math.round(Math.min(max, Math.max(min, requestedWidth)));
	let changed = false;
	for (const property of properties) {
		const info = view.columnInfo[property];
		const eligibleWhenUnset = initiallyUnset ? initiallyUnset.has(property) : (info?.customWidth ?? 0) === 0;
		if (!info || (applyTo === 'unset' && !eligibleWhenUnset)) continue;
		info.customWidth = width;
		changed = true;
	}
	if (!changed) return true;
	view.updateVirtualDisplay();
	saveNativeColumnSizes(view, properties);
	return true;
}

export function getNativeUnsetColumnProperties(
	app: App,
	scope: HTMLElement,
	selectedWidth?: number | null,
): string[] {
	const view = findNativeTableView(app, scope);
	if (!view) return [];
	return nativeProperties(view).filter((property) => {
		const currentWidth = view.columnInfo?.[property]?.customWidth ?? 0;
		if (currentWidth === 0) return true;
		return selectedWidth !== null && selectedWidth !== undefined && currentWidth === selectedWidth;
	});
}

export function getNativeColumnWidthState(
	app: App,
	scope: HTMLElement,
): { custom: number; total: number } {
	const view = findNativeTableView(app, scope);
	const properties = nativeProperties(view);
	return {
		custom: properties.filter((property) => (view?.columnInfo?.[property]?.customWidth ?? 0) > 0).length,
		total: properties.length,
	};
}

export function getNativeColumnWidths(app: App, scope: HTMLElement): Record<string, number> {
	const view = findNativeTableView(app, scope);
	const widths: Record<string, number> = {};
	for (const property of nativeProperties(view)) {
		widths[property] = view?.columnInfo?.[property]?.customWidth ?? 0;
	}
	return widths;
}

export function getNativeColumnHeaders(app: App, scope: HTMLElement): NativeColumnHeader[] {
	const view = findNativeTableView(app, scope);
	const nativeHeaders = view?.header?.cells?.flatMap((cell) =>
		typeof cell.prop === 'string' && isHTMLElement(cell.el)
			? [{ propertyId: cell.prop, element: cell.el }]
			: []) ?? [];
	if (nativeHeaders.length > 0) return nativeHeaders;

	// Useful for DOM fixtures and defensive compatibility if Obsidian ever
	// exposes property IDs directly on header cells.
	return [...scope.querySelectorAll<HTMLElement>(
		'.bases-thead .bases-td[data-property], .bases-thead [data-property].bases-table-header',
	)].flatMap((element) => {
		const propertyId = element.dataset.property?.trim();
		return propertyId ? [{ propertyId, element }] : [];
	});
}

export function getNativeMainProperty(app: App, scope: HTMLElement): string | null {
	const first = findNativeTableView(app, scope)?.config.getOrder?.()[0];
	if (typeof first === 'string') return first.trim() || null;
	if (!isObject(first)) return null;
	const id = first.id;
	return typeof id === 'string' ? id.trim() || null : null;
}

export function getNativeGroupProperty(app: App, scope: HTMLElement): string | null {
	const config = findNativeTableView(app, scope)?.config;
	const groupBy = config?.groupBy ?? config?.get('groupBy');
	if (!isObject(groupBy)) return null;
	const property = groupBy.property;
	return typeof property === 'string' ? property.trim() || null : null;
}

export function getNativeColumnAppearance(
	app: App,
	scope: HTMLElement,
	propertyId: string,
): NativeColumnAppearance {
	const view = findNativeTableView(app, scope);
	const stored = view?.config.get(COLUMN_APPEARANCE_CONFIG_KEY);
	if (!isObject(stored)) return { ...DEFAULT_COLUMN_APPEARANCE };
	return normalizeColumnAppearance(stored[propertyId]);
}

export function setNativeColumnAppearance(
	app: App,
	scope: HTMLElement,
	propertyId: string,
	appearance: NativeColumnAppearance,
): boolean {
	const view = findNativeTableView(app, scope);
	if (!view) return false;
	const current = view.config.get(COLUMN_APPEARANCE_CONFIG_KEY);
	const stored = isObject(current) ? { ...current } : {};
	const normalized = normalizeColumnAppearance(appearance);
	if (isDefaultColumnAppearance(normalized)) delete stored[propertyId];
	else stored[propertyId] = normalized;
	view.config.set(
		COLUMN_APPEARANCE_CONFIG_KEY,
		Object.keys(stored).length > 0 ? stored : null,
	);
	return true;
}

export function findNativeTableView(app: App, scope: HTMLElement): NativeTableView | null {
	const cached = VIEW_CACHE.get(scope);
	if (cached?.containerEl.isConnected && elementsOverlap(cached.containerEl, scope)) return cached;
	VIEW_CACHE.delete(scope);
	const leaves = [
		...app.workspace.getLeavesOfType('bases'),
		...app.workspace.getLeavesOfType('markdown'),
	];
	for (const leaf of leaves) {
		const candidate = findInLeaf(leaf, scope);
		if (candidate) {
			VIEW_CACHE.set(scope, candidate);
			return candidate;
		}
	}
	return null;
}

function findInLeaf(leaf: WorkspaceLeaf, scope: HTMLElement): NativeTableView | null {
	const queue: Array<{ value: unknown; depth: number }> = [{ value: leaf.view, depth: 0 }];
	const visited = new WeakSet<object>();
	let inspected = 0;

	while (queue.length && inspected < 1500) {
		const entry = queue.shift();
		if (!entry || !isObject(entry.value) || visited.has(entry.value)) continue;
		visited.add(entry.value);
		inspected += 1;
		if (isNativeTableView(entry.value) && elementsOverlap(entry.value.containerEl, scope)) {
			return entry.value;
		}
		if (entry.depth >= 7 || isDomNode(entry.value)) continue;
		for (const [key, child] of Object.entries(entry.value)) {
			if (SKIPPED_GRAPH_KEYS.has(key) || typeof child === 'function') continue;
			if (isObject(child)) queue.push({ value: child, depth: entry.depth + 1 });
		}
	}
	return null;
}

const SKIPPED_GRAPH_KEYS = new Set([
	'app', 'workspace', 'vault', 'metadataCache', 'fileManager', 'keymap',
	'ownerDocument', 'win', 'doc', 'parentElement', 'parentNode',
]);

function isNativeTableView(value: object): value is NativeTableView {
	const candidate = value as Partial<NativeTableView>;
	return candidate.type === 'table' && isHTMLElement(candidate.containerEl) &&
		isObject(candidate.config) && typeof candidate.config.get === 'function' &&
		typeof candidate.config.set === 'function';
}

function elementsOverlap(first: HTMLElement, second: HTMLElement): boolean {
	return first === second || first.contains(second) || second.contains(first);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function normalizeColumnAppearance(value: unknown): NativeColumnAppearance {
	if (!isObject(value)) return { ...DEFAULT_COLUMN_APPEARANCE };
	const tone = value.tone === 'muted' || value.tone === 'faint' || value.tone === 'custom'
		? value.tone
		: 'default';
	const color = tone === 'custom' && typeof value.color === 'string'
		? normalizeHex(value.color) ?? undefined
		: undefined;
	return {
		tone: tone === 'custom' && !color ? 'default' : tone,
		bold: value.bold === true,
		...(color ? { color } : {}),
	};
}

function isDefaultColumnAppearance(appearance: NativeColumnAppearance): boolean {
	return appearance.tone === 'default' && !appearance.bold;
}

function isDomNode(value: object): boolean {
	return 'nodeType' in value && typeof value.nodeType === 'number';
}

function isHTMLElement(value: unknown): value is HTMLElement {
	return isObject(value) && value.nodeType === 1 &&
		typeof value.contains === 'function' && typeof value.querySelector === 'function';
}

function cssNumber(element: HTMLElement, property: string, fallback: number): number {
	const value = Number.parseFloat(element.ownerDocument.defaultView?.getComputedStyle(element)
		.getPropertyValue(property) ?? '');
	return Number.isFinite(value) ? value : fallback;
}

function finiteOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nativeProperties(view: NativeTableView | null): string[] {
	return view?.data?.properties?.filter((property): property is string =>
		typeof property === 'string') ?? [];
}

function saveNativeColumnSizes(
	view: NativeTableView,
	properties: string[],
): void {
	if (view.saveColumnSizes) {
		view.saveColumnSizes();
		return;
	}
	const widths: Record<string, number> = {};
	for (const property of properties) {
		const customWidth = view.columnInfo?.[property]?.customWidth ?? 0;
		if (customWidth > 0) widths[property] = customWidth;
	}
	view.config.set('columnSize', widths);
}

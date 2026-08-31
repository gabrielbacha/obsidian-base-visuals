import { setIcon, type App, type EventRef, type WorkspaceLeaf } from 'obsidian';
import { encodeOptionKey, resolveColor } from './colors';
import {
	getNativeColumnAppearance,
	getNativeColumnHeaders,
	getNativeGroupProperty,
	getNativeMainProperty,
	getNativePropertyKind,
	getNativePropertyDisplayName,
	resolveNativePropertyId,
	type NativeColumnAppearance,
} from './native-table-view';
import { evaluateRule, ruleColorVariables, ruleHasFormatting } from './rules';
import { SettingsStore } from './settings-store';
import { BaseVisualStoreRepository } from './base-visual-store';
import { ConditionalRule, OptionIdentity, type PaletteTemplateId } from './types';
import { TableLayoutPopover } from '../ui/table-layout-popover';
import { ColumnAppearancePopover } from '../ui/column-appearance-popover';
import { ColumnPillAppearancePopover } from '../ui/column-pill-appearance-popover';
import { compareNaturalValues } from './value-order';
import { strategyLabel } from './property-strategies';
import { NativePillRemovalService, type PillRemovalCapability } from './native-pill-removal';

const PILL_SELECTOR = '.multi-select-pill';
const BASE_SCOPE_SELECTOR = '.bases-view, .bases-embed';
const CELL_SELECTOR = '.bases-td[data-property], .bases-table-cell[data-property]';
const ROW_SELECTOR = '.bases-tr';
const GROUP_HEADING_SELECTOR = '.bases-group-heading';
const TOOLBAR_SELECTOR = '.bases-toolbar, .query-toolbar';
const TABLE_SELECTOR = '.bases-table-container';
const TOOLBAR_CONTROL_SELECTOR = [
	'.bpc-conditional-formatting-button',
	'.bpc-table-layout-button',
].join(',');
const TREE_SELECTOR = [
	PILL_SELECTOR,
	CELL_SELECTOR,
	ROW_SELECTOR,
	GROUP_HEADING_SELECTOR,
	TABLE_SELECTOR,
	TOOLBAR_SELECTOR,
	TOOLBAR_CONTROL_SELECTOR,
].join(',');

interface TrackedPill {
	identity: OptionIdentity;
	key: string;
	originalTitle: string | null;
	originalAriaLabel: string | null;
}

interface TrackedGroupHeading {
	identity: OptionIdentity;
	key: string;
}

interface RootBinding {
	observer: MutationObserver;
	inputHandler: (event: Event) => void;
	clickHandler: (event: MouseEvent) => void;
	contextMenuHandler: (event: MouseEvent) => void;
	pointerDownHandler: (event: PointerEvent) => void;
	focusInHandler: (event: FocusEvent) => void;
	keyDownHandler: (event: KeyboardEvent) => void;
	activePill: HTMLElement | null;
}

export type OpenRuleManager = (propertyIds: string[], scope?: HTMLElement) => void;
export interface ColumnMenuRequest {
	document: Document;
	point: { x: number; y: number };
	propertyId: string;
	propertyName?: string;
	value: string;
	values: string[];
	removal: PillRemovalCapability;
	store?: SettingsStore;
}
export type OpenColumnManager = (request: ColumnMenuRequest) => void;

export class PillEnhancer {
	private readonly roots = new Map<HTMLElement, RootBinding>();
	private readonly tracked = new WeakMap<HTMLElement, TrackedPill>();
	private readonly trackedGroups = new WeakMap<HTMLElement, TrackedGroupHeading>();
	private readonly visibleByKey = new Map<string, Set<HTMLElement>>();
	private readonly visibleGroupsByKey = new Map<string, Set<HTMLElement>>();
	private readonly visibleRows = new Set<HTMLElement>();
	private readonly visibleCells = new Set<HTMLElement>();
	private readonly tableValues = new Map<HTMLElement, Map<string, Set<string>>>();
	private readonly tables = new Set<HTMLElement>();
	private readonly columnAppearanceElements = new Set<HTMLElement>();
	private readonly toolbarControls = new Set<HTMLElement>();
	private readonly pendingMenuObservers = new Set<MutationObserver>();
	private readonly scopedStoreUnsubscribers = new Map<SettingsStore, () => void>();
	private readonly mainPropertyByTable = new WeakMap<HTMLElement, string>();
	private readonly tableLayoutPopover: TableLayoutPopover;
	private readonly columnAppearancePopover: ColumnAppearancePopover;
	private readonly columnPillAppearancePopover: ColumnPillAppearancePopover;
	private readonly pillRemoval = new NativePillRemovalService();
	private unsubscribeStore: (() => void) | null = null;
	private started = false;

	constructor(
		private readonly app: App,
		private readonly store: SettingsStore,
		private readonly openRuleManager: OpenRuleManager = () => undefined,
		private readonly openColumnManager: OpenColumnManager = () => undefined,
		private readonly storeForScope: (scope: HTMLElement) => SettingsStore = () => store,
		private readonly baseStores?: BaseVisualStoreRepository,
	) {
		this.tableLayoutPopover = new TableLayoutPopover(app, store);
		this.columnAppearancePopover = new ColumnAppearancePopover(app, baseStores);
		this.columnPillAppearancePopover = new ColumnPillAppearancePopover();
	}

	start(registerEvent: (eventRef: EventRef) => void): void {
		if (this.started) return;
		this.started = true;
		this.unsubscribeStore = this.store.subscribe(() => this.refreshFromStore());
		registerEvent(this.app.workspace.on('layout-change', () => this.refreshRoots()));
		registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshRoots()));
		this.refreshRoots();
	}

	observeRoot(root: HTMLElement): void {
		if (this.roots.has(root)) return;
		const Observer = root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
		const observer = new Observer((mutations) => {
			const removedRoots: Element[] = [];
			const addedRoots: Element[] = [];
			const refreshTargets = new Set<Element>();
			const classTargets = new Set<HTMLElement>();
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.removedNodes)) {
					const element = asElement(node);
					if (element) removedRoots.push(element);
				}
				for (const node of Array.from(mutation.addedNodes)) {
					const element = asElement(node);
					if (element) addedRoots.push(element);
				}
				const target = mutationElement(mutation.target);
				if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
					if (target) classTargets.add(target as HTMLElement);
					continue;
				}
				if (target) refreshTargets.add(target);
			}
			for (const element of deduplicateRoots(removedRoots)) this.untrackTree(element);
			for (const element of deduplicateRoots(addedRoots)) this.processTree(element);
			for (const target of classTargets) {
				if (target.isConnected && (target === root || root.contains(target))) {
					this.recoverPluginClasses(target);
				}
			}
			for (const target of deduplicateRoots([...refreshTargets])) {
				if (target.isConnected && (target === root || root.contains(target))) this.refreshAround(target);
			}
		});
		observer.observe(root, {
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
			attributeFilter: ['data-property', 'aria-checked', 'class'],
		});

		const inputHandler = (event: Event) => {
			const target = asElement(event.target);
			if (target) this.refreshAround(target);
		};
		const contextMenuHandler = (event: MouseEvent) => this.handleContextMenu(event);
		const clickHandler = (event: MouseEvent) => this.handleNativeRemoveClick(event);
		const pointerDownHandler = (event: PointerEvent) => this.handlePillPointerDown(root, event);
		const focusInHandler = (event: FocusEvent) => this.handlePillFocusIn(root, event);
		const keyDownHandler = (event: KeyboardEvent) => this.handlePillKeyDown(root, event);
		root.addEventListener('input', inputHandler);
		root.addEventListener('change', inputHandler);
		root.addEventListener('click', clickHandler, true);
		root.addEventListener('contextmenu', contextMenuHandler, true);
		root.addEventListener('pointerdown', pointerDownHandler, true);
		root.addEventListener('focusin', focusInHandler, true);
		root.addEventListener('keydown', keyDownHandler, true);
		this.roots.set(root, {
			observer,
			inputHandler,
			clickHandler,
			contextMenuHandler,
			pointerDownHandler,
			focusInHandler,
			keyDownHandler,
			activePill: null,
		});
		this.processTree(root);
	}

	stop(): void {
		this.started = false;
		this.unsubscribeStore?.();
		this.unsubscribeStore = null;
		for (const unsubscribe of this.scopedStoreUnsubscribers.values()) unsubscribe();
		this.scopedStoreUnsubscribers.clear();
		for (const root of [...this.roots.keys()]) this.detachRoot(root);
		this.visibleByKey.clear();
		this.visibleGroupsByKey.clear();
		this.visibleRows.clear();
		this.visibleCells.clear();
		this.tableValues.clear();
		this.tables.clear();
		this.tableLayoutPopover.close();
		this.columnAppearancePopover.close();
		this.columnPillAppearancePopover.close();
		this.pillRemoval.dispose();
		for (const observer of this.pendingMenuObservers) observer.disconnect();
		this.pendingMenuObservers.clear();
		for (const element of this.columnAppearanceElements) clearColumnAppearance(element);
		this.columnAppearanceElements.clear();
		this.toolbarControls.clear();
	}

	private refreshRoots(): void {
		const nextRoots = new Set<HTMLElement>();
		const leaves = [
			...this.app.workspace.getLeavesOfType('bases'),
			...this.app.workspace.getLeavesOfType('markdown'),
		];
		for (const leaf of leaves) {
			const root = leafContainer(leaf);
			if (!root) continue;
			nextRoots.add(root);
			this.observeRoot(root);
		}
		for (const root of this.roots.keys()) {
			if (!nextRoots.has(root)) this.detachRoot(root);
		}
	}

	private detachRoot(root: HTMLElement): void {
		const binding = this.roots.get(root);
		if (!binding) return;
		binding.observer.disconnect();
		this.columnAppearancePopover.close();
		this.columnPillAppearancePopover.close();
		root.removeEventListener('input', binding.inputHandler);
		root.removeEventListener('change', binding.inputHandler);
		root.removeEventListener('click', binding.clickHandler, true);
		root.removeEventListener('contextmenu', binding.contextMenuHandler, true);
		root.removeEventListener('pointerdown', binding.pointerDownHandler, true);
		root.removeEventListener('focusin', binding.focusInHandler, true);
		root.removeEventListener('keydown', binding.keyDownHandler, true);
		this.setActivePill(root, null);
		this.cleanupTrackedRoot(root);
		for (const host of this.tableValues.keys()) {
			if (host === root || root.contains(host)) this.tableValues.delete(host);
		}
		this.roots.delete(root);
	}

	private processTree(node: Node): void {
		const element = asElement(node);
		if (!element) return;
		const buckets = collectTreeBuckets(element);
		for (const item of buckets.pills) this.processPill(item);
		for (const item of buckets.cells) this.processCell(item);
		for (const item of buckets.rows) this.processRow(item);
		for (const item of buckets.groups) this.processGroupHeading(item);
		for (const item of buckets.tables) this.processTable(item);
		for (const item of buckets.toolbars) this.processToolbar(item);
		const ancestorPill = element.closest<HTMLElement>(PILL_SELECTOR);
		if (ancestorPill) this.processPill(ancestorPill);
		const ancestorGroup = element.closest<HTMLElement>(GROUP_HEADING_SELECTOR);
		if (ancestorGroup) this.processGroupHeading(ancestorGroup);
	}

	private untrackTree(node: Node): void {
		const element = asElement(node);
		if (!element) return;
		const buckets = collectTreeBuckets(element);
		for (const item of buckets.pills) this.untrackPill(item);
		for (const item of buckets.cells) this.untrackCell(item);
		for (const item of buckets.rows) this.untrackRow(item);
		for (const item of buckets.groups) this.untrackGroupHeading(item);
		for (const item of buckets.tables) this.untrackTable(item);
		for (const item of buckets.controls) this.toolbarControls.delete(item);
		for (const host of this.tableValues.keys()) {
			if (host === element || element.contains(host)) this.tableValues.delete(host);
		}
	}

	private cleanupTrackedRoot(root: HTMLElement): void {
		this.setActivePill(root, null);
		for (const elements of [...this.visibleByKey.values()]) {
			for (const pill of [...elements]) if (belongsToRoot(root, pill)) this.untrackPill(pill);
		}
		for (const elements of [...this.visibleGroupsByKey.values()]) {
			for (const heading of [...elements]) if (belongsToRoot(root, heading)) this.untrackGroupHeading(heading);
		}
		for (const cell of [...this.visibleCells]) if (belongsToRoot(root, cell)) this.untrackCell(cell);
		for (const row of [...this.visibleRows]) if (belongsToRoot(root, row)) this.untrackRow(row);
		for (const table of [...this.tables]) if (belongsToRoot(root, table)) this.untrackTable(table);
		for (const element of [...this.columnAppearanceElements]) {
			if (!belongsToRoot(root, element)) continue;
			clearColumnAppearance(element);
			this.columnAppearanceElements.delete(element);
		}
		for (const control of [...this.toolbarControls]) {
			if (!belongsToRoot(root, control)) continue;
			control.remove();
			this.toolbarControls.delete(control);
		}
	}

	private refreshAround(element: Element): void {
		const toolbar = element.matches(TOOLBAR_SELECTOR)
			? element as HTMLElement
			: element.closest<HTMLElement>(TOOLBAR_SELECTOR);
		if (toolbar) this.processToolbar(toolbar);
		const pill = element.closest<HTMLElement>(PILL_SELECTOR);
		if (pill) this.processPill(pill);
		const cell = element.closest<HTMLElement>(CELL_SELECTOR);
		if (cell) this.processCell(cell);
		const row = element.closest<HTMLElement>(ROW_SELECTOR);
		if (row) this.processRow(row);
		const group = element.closest<HTMLElement>(GROUP_HEADING_SELECTOR);
		if (group) this.processGroupHeading(group);
		const table = element.matches(TABLE_SELECTOR)
			? element as HTMLElement
			: element.closest<HTMLElement>(TABLE_SELECTOR);
		if (table) this.processTable(table);
	}

	private recoverPluginClasses(element: HTMLElement): void {
		if (this.tracked.has(element) || element.matches(PILL_SELECTOR)) {
			this.processPill(element);
			return;
		}
		if (this.trackedGroups.has(element) || element.matches(GROUP_HEADING_SELECTOR)) {
			this.processGroupHeading(element);
			return;
		}
		if (element.matches(TABLE_SELECTOR)) this.processTable(element);
	}

	private processCell(cell: HTMLElement): void {
		const scope = findBaseTableHost(cell);
		if (!scope) return;
		const propertyId = this.propertyIdFor(scope, cell);
		if (!propertyId) return;
		this.visibleCells.add(cell);
		this.scopedStore(scope).discoverProperty(propertyId);
		this.applyCellRule(cell, propertyId);
		if (cell.closest('.bases-thead')) {
			clearColumnAppearance(cell);
			this.columnAppearanceElements.delete(cell);
		} else this.applyColumnAppearance(cell, scope, propertyId);
		const table = cell.closest<HTMLElement>(TABLE_SELECTOR);
		if (table) this.applyMainColumn(table, cell);
	}

	private processRow(row: HTMLElement): void {
		if (!row.closest(BASE_SCOPE_SELECTOR)) return;
		this.visibleRows.add(row);
		this.applyRowRule(row);
	}

	private processGroupHeading(heading: HTMLElement): void {
		if (!heading.closest('.bases-table, .bases-table-container')) {
			this.untrackGroupHeading(heading);
			return;
		}
		const scope = findBaseTableHost(heading);
		const value = heading.querySelector<HTMLElement>('.bases-group-value')?.textContent?.trim() ?? '';
		const propertyId = scope ? this.propertyIdFor(scope, groupPropertyId(this.app, scope, heading) ?? '') : null;
		if (!scope || !propertyId || !value) {
			this.untrackGroupHeading(heading);
			return;
		}

		const identity = { propertyId, value };
		const key = encodeOptionKey(identity);
		const existing = this.trackedGroups.get(heading);
		if (existing?.key !== key) this.untrackGroupHeading(heading);
		if (!this.trackedGroups.has(heading)) {
			this.trackedGroups.set(heading, { identity, key });
			const elements = this.visibleGroupsByKey.get(key) ?? new Set<HTMLElement>();
			elements.add(heading);
			this.visibleGroupsByKey.set(key, elements);
		}
		this.rememberTableValue(scope, identity);
		this.scopedStore(scope).ensure(identity);
		this.applyGroupHeadingAppearance(heading, identity, scope);
	}

	private processToolbar(toolbar: HTMLElement): void {
		const scope = findBaseTableHost(toolbar);
		if (!scope?.querySelector(CELL_SELECTOR)) return;
		const anchor = findToolbarInsertionAnchor(toolbar);
		const parent = anchor?.parentElement ?? toolbar;
		const formatItem = this.ensureToolbarControl(
			toolbar,
			'bpc-conditional-formatting-button',
			'palette',
			'Format',
			'Bases visuals',
			() => this.openRuleManager(this.propertyIdsInScope(scope), scope),
		);
		const layoutItem = this.ensureToolbarControl(
			toolbar,
			'bpc-table-layout-button',
			'layout-grid',
			'Layout',
			'Table layout',
			(button) => this.tableLayoutPopover.toggle(button, scope),
		);
		let cursor: ChildNode | null = anchor ?? parent.firstChild;
		for (const item of [layoutItem, formatItem]) {
			if (item.nextSibling !== cursor) parent.insertBefore(item, cursor);
			cursor = item;
		}
	}

	private ensureToolbarControl(
		toolbar: HTMLElement,
		className: string,
		icon: string,
		label: string,
		title: string,
		onActivate: (button: HTMLElement) => void,
	): HTMLElement {
		const existing = toolbar.querySelector<HTMLElement>(`.${className}`);
		if (existing) {
			this.toolbarControls.add(existing);
			return existing;
		}
		const item = toolbar.createDiv(`bases-toolbar-item bpc-toolbar-control ${className}`);
		const button = item.createDiv('text-icon-button');
		button.setAttribute('role', 'button');
		button.tabIndex = 0;
		button.setAttribute('aria-label', title);
		button.title = title;
		const iconElement = button.createSpan({ cls: 'text-button-icon' });
		setIcon(iconElement, icon);
		button.createSpan({ cls: 'text-button-label', text: label });
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onActivate(button);
		});
		button.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			button.click();
		});
		this.toolbarControls.add(item);
		return item;
	}

	private processTable(table: HTMLElement): void {
		if (!table.closest(BASE_SCOPE_SELECTOR)) return;
		setClass(table, 'bpc-table', true);
		this.tables.add(table);
		const scope = findBaseTableHost(table);
		const primary = scope ? this.propertyIdFor(scope, getNativeMainProperty(this.app, scope) ?? '') : null;
		this.updateMainColumn(table, primary ?? undefined);
		if (scope) this.refreshColumnAppearances(scope);
	}

	private updateMainColumn(table: HTMLElement, configuredPrimary?: string): void {
		const primary = configuredPrimary ?? table.querySelector<HTMLElement>(
			'.bases-thead .bases-td[data-property], .bases-thead [data-property].bases-table-header',
		)?.dataset.property?.trim() ?? table.querySelector<HTMLElement>(
			'.bases-tbody .bases-td[data-property], .bases-tbody .bases-table-cell[data-property]',
		)?.dataset.property?.trim();
		if (!primary) return;
		this.mainPropertyByTable.set(table, primary);
		for (const cell of table.querySelectorAll<HTMLElement>(CELL_SELECTOR)) {
			this.applyMainColumn(table, cell, primary);
		}
	}

	private applyMainColumn(table: HTMLElement, cell: HTMLElement, primaryProperty?: string): void {
		const primary = primaryProperty ?? this.mainPropertyByTable.get(table) ?? table.querySelector<HTMLElement>(
			'.bases-thead .bases-td[data-property], .bases-thead [data-property].bases-table-header',
		)?.dataset.property?.trim() ?? table.querySelector<HTMLElement>(
			'.bases-tbody .bases-td[data-property], .bases-tbody .bases-table-cell[data-property]',
		)?.dataset.property?.trim();
		const scope = findBaseTableHost(cell);
		const cellProperty = scope ? this.propertyIdFor(scope, cell) : cell.dataset.property?.trim();
		cell.classList.toggle(
			'bpc-main-column',
			Boolean(primary) && cellProperty === primary,
		);
	}

	private untrackTable(table: HTMLElement): void {
		table.classList.remove('bpc-table');
		this.tables.delete(table);
	}

	private propertyIdsInScope(scope: HTMLElement): string[] {
		return [...new Set([...scope.querySelectorAll<HTMLElement>(CELL_SELECTOR)]
			.map((cell) => this.propertyIdFor(scope, cell))
			.filter((value): value is string => Boolean(value)))];
	}

	private processPill(pill: HTMLElement): void {
		if (!pill.closest(BASE_SCOPE_SELECTOR)) {
			this.untrackPill(pill);
			return;
		}
		const host = findBaseTableHost(pill);
		const cell = pill.closest<HTMLElement>(CELL_SELECTOR);
		const propertyId = host && cell ? this.propertyIdFor(host, cell) : null;
		const value = pill.querySelector<HTMLElement>('.multi-select-pill-content')?.textContent?.trim() ?? '';
		if (!propertyId || !value) {
			this.untrackPill(pill);
			return;
		}

		const identity = { propertyId, value };
		if (!host) {
			this.untrackPill(pill);
			return;
		}
		this.rememberTableValue(host, identity);
		const key = encodeOptionKey(identity);
		const existing = this.tracked.get(pill);
		if (existing?.key !== key) this.untrackPill(pill);
		if (!this.tracked.has(pill)) {
			this.tracked.set(pill, {
				identity,
				key,
				originalTitle: pill.getAttribute('title'),
				originalAriaLabel: pill.getAttribute('aria-label'),
			});
			const elements = this.visibleByKey.get(key) ?? new Set<HTMLElement>();
			elements.add(pill);
			this.visibleByKey.set(key, elements);
		}
		this.scopedStore(host).ensure(identity);
		this.applyPillAppearance(pill, identity, host);
	}

	private rememberTableValue(host: HTMLElement, identity: OptionIdentity): void {
		const properties = this.tableValues.get(host) ?? new Map<string, Set<string>>();
		const values = properties.get(identity.propertyId) ?? new Set<string>();
		values.add(identity.value);
		properties.set(identity.propertyId, values);
		this.tableValues.set(host, properties);
	}

	private handleContextMenu(event: MouseEvent): void {
		const target = asElement(event.target);
		const pill = target?.closest<HTMLElement>('.bpc-pill');
		if (!pill) {
			this.handleHeaderContextMenu(target);
			return;
		}
		const metadata = this.tracked.get(pill);
		const host = findBaseTableHost(pill);
		if (!metadata || !host) return;

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		this.openColumnManager({
			document: pill.ownerDocument,
			point: { x: event.clientX, y: event.clientY },
			propertyId: metadata.identity.propertyId,
			propertyName: getNativePropertyDisplayName(this.app, host, metadata.identity.propertyId),
			value: metadata.identity.value,
			values: [...(this.tableValues.get(host)?.get(metadata.identity.propertyId) ?? [])]
				.sort(compareNaturalValues),
			removal: this.pillRemoval.capability(pill),
			store: this.scopedStore(host),
		});
	}

	private handleNativeRemoveClick(event: MouseEvent): void {
		const target = asElement(event.target);
		const control = target?.closest<HTMLElement>('.multi-select-pill-remove-button');
		const pill = control?.closest<HTMLElement>(PILL_SELECTOR);
		if (pill && this.tracked.has(pill)) this.pillRemoval.observeNativeRemoval(pill);
	}

	private handlePillPointerDown(root: HTMLElement, event: PointerEvent): void {
		const target = asElement(event.target);
		const pill = target?.closest<HTMLElement>('.bpc-pill') ?? null;
		this.setActivePill(root, pill && this.tracked.has(pill) ? pill : null);
	}

	private handlePillFocusIn(root: HTMLElement, event: FocusEvent): void {
		const target = asElement(event.target);
		const pill = target?.closest<HTMLElement>('.bpc-pill') ?? null;
		if (pill && this.tracked.has(pill)) {
			this.setActivePill(root, pill);
			return;
		}
		const activePill = this.roots.get(root)?.activePill;
		const activeCell = activePill?.closest(CELL_SELECTOR);
		if (activePill && activeCell && target && activeCell.contains(target)) return;
		this.setActivePill(root, null);
	}

	private handlePillKeyDown(root: HTMLElement, event: KeyboardEvent): void {
		if (event.key !== 'Delete' && event.key !== 'Backspace') return;
		if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = asElement(event.target);
		const binding = this.roots.get(root);
		const pill = binding?.activePill;
		if (!pill?.isConnected || !this.tracked.has(pill)) {
			this.setActivePill(root, null);
			return;
		}
		if (isTextEditingTarget(target, pill)) return;
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		this.setActivePill(root, null);
		this.pillRemoval.remove(pill);
	}

	private setActivePill(root: HTMLElement, pill: HTMLElement | null): void {
		const binding = this.roots.get(root);
		if (!binding || binding.activePill === pill) return;
		binding.activePill?.classList.remove('bpc-pill--active');
		binding.activePill = pill;
		pill?.classList.add('bpc-pill--active');
	}

	private handleHeaderContextMenu(target: Element | null): void {
		const headerCell = target?.closest<HTMLElement>('.bases-thead .bases-td');
		if (!headerCell) return;
		const scope = findBaseTableHost(headerCell);
		if (!scope) return;
		const header = getNativeColumnHeaders(this.app, scope).find(({ element }) =>
			element === headerCell || element.contains(headerCell) || headerCell.contains(element));
		if (!header) return;
		this.waitForHeaderMenu(
			headerCell.ownerDocument,
			headerCell,
			scope,
			this.propertyIdFor(scope, header.propertyId) ?? header.propertyId,
		);
	}

	private waitForHeaderMenu(
		doc: Document,
		headerCell: HTMLElement,
		scope: HTMLElement,
		propertyId: string,
	): void {
		const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
		let observer: MutationObserver | null = null;
		let timeout = 0;
		const finish = () => {
			if (observer) {
				observer.disconnect();
				this.pendingMenuObservers.delete(observer);
			}
			if (timeout) doc.defaultView?.clearTimeout(timeout);
		};
		const inject = () => {
			const menus = [...doc.body.querySelectorAll<HTMLElement>('.menu')];
			const menu = [...menus].reverse().find((candidate) =>
				candidate.isConnected && !candidate.classList.contains('bases-toolbar-menu'));
			if (!menu) return false;
			this.injectColumnMenuItems(menu, scope, propertyId);
			finish();
			return true;
		};
		observer = new Observer(() => inject());
		observer.observe(doc.body, { childList: true, subtree: true });
		this.pendingMenuObservers.add(observer);
		timeout = doc.defaultView?.setTimeout(finish, 750) ?? 0;
	}

	private injectColumnMenuItems(
		menu: HTMLElement,
		scope: HTMLElement,
		propertyId: string,
	): void {
		if (this.shouldOfferPillAppearance(scope, propertyId)) {
			this.injectPillAppearanceMenuItem(menu, scope, propertyId);
		}
		this.injectColumnAppearanceMenuItem(menu, scope, propertyId);
	}

	private injectPillAppearanceMenuItem(
		menu: HTMLElement,
		scope: HTMLElement,
		propertyId: string,
	): void {
		if (menu.querySelector('.bpc-column-pill-appearance-menu-item')) return;
		const store = this.scopedStore(scope);
		const displayName = getNativePropertyDisplayName(this.app, scope, propertyId)
			?? propertyId.replace(/^(?:note|file|formula)\./, '');
		const content = menu.querySelector<HTMLElement>(':scope > .menu-scroll') ?? menu;
		const item = content.createDiv('menu-item tappable bpc-column-pill-appearance-menu-item');
		item.setAttribute('role', 'menuitem');
		item.tabIndex = -1;
		const icon = item.createSpan('menu-item-icon');
		setIcon(icon, 'palette');
		item.createDiv({ cls: 'menu-item-title', text: 'Pill appearance' });
		item.createDiv({ cls: 'menu-item-flair', text: describePillAppearance(store, propertyId, displayName) });
		const chevron = item.createSpan('menu-item-icon');
		setIcon(chevron, 'chevron-right');
		let openTimer = 0;
		const open = () => {
			if (openTimer) item.ownerDocument.defaultView?.clearTimeout(openTimer);
			item.classList.add('selected');
			this.columnAppearancePopover.close();
			this.columnPillAppearancePopover.open(item, store, propertyId, displayName, () => {
				item.querySelector<HTMLElement>('.menu-item-flair')!.textContent =
					describePillAppearance(store, propertyId, displayName);
				this.refreshFromStore();
			});
		};
		item.addEventListener('pointerenter', () => {
			content.querySelectorAll<HTMLElement>('.menu-item.selected').forEach((candidate) => {
				if (candidate !== item) candidate.classList.remove('selected');
			});
			item.classList.add('selected');
			openTimer = item.ownerDocument.defaultView?.setTimeout(open, 120) ?? 0;
		});
		item.addEventListener('pointerleave', () => {
			if (openTimer) item.ownerDocument.defaultView?.clearTimeout(openTimer);
			openTimer = 0;
		});
		item.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			open();
		});
		item.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			open();
		});
		const appearanceItem = content.querySelector(':scope > .bpc-column-appearance-menu-item');
		if (appearanceItem) appearanceItem.before(item);
		else {
			const firstSeparator = content.querySelector(':scope > .menu-separator');
			if (firstSeparator) firstSeparator.before(item);
			else content.append(item);
		}
	}

	private shouldOfferPillAppearance(scope: HTMLElement, propertyId: string): boolean {
		if ((this.tableValues.get(scope)?.get(propertyId)?.size ?? 0) > 0) return true;
		for (const pill of scope.querySelectorAll<HTMLElement>(PILL_SELECTOR)) {
			const cell = pill.closest<HTMLElement>(CELL_SELECTOR);
			if (cell && this.propertyIdFor(scope, cell) === propertyId) return true;
		}
		const kind = getNativePropertyKind(this.app, scope, propertyId);
		if (kind === 'non-list') return false;
		if (kind === 'list') return true;
		return this.scopedStore(scope).allOptions().some((option) => option.propertyId === propertyId);
	}

	private injectColumnAppearanceMenuItem(
		menu: HTMLElement,
		scope: HTMLElement,
		propertyId: string,
	): void {
		if (menu.querySelector('.bpc-column-appearance-menu-item')) return;
		const appearance = getNativeColumnAppearance(
			this.app,
			scope,
			propertyId,
			this.baseStores?.getBaseColumnAppearances(scope),
		);
		const content = menu.querySelector<HTMLElement>(':scope > .menu-scroll') ?? menu;
		const item = content.createDiv('menu-item tappable bpc-column-appearance-menu-item');
		item.setAttribute('role', 'menuitem');
		item.tabIndex = -1;
		const icon = item.createSpan('menu-item-icon');
		setIcon(icon, 'paintbrush');
		item.createDiv({ cls: 'menu-item-title', text: 'Column appearance' });
		item.createDiv({ cls: 'menu-item-flair', text: describeColumnAppearance(appearance) });
		const chevron = item.createSpan('menu-item-icon');
		setIcon(chevron, 'chevron-right');
		let openTimer = 0;
		const open = () => {
			if (openTimer) item.ownerDocument.defaultView?.clearTimeout(openTimer);
			item.classList.add('selected');
			this.columnPillAppearancePopover.close();
			this.columnAppearancePopover.open(item, scope, propertyId, () =>
				this.refreshColumnAppearances(scope, propertyId));
		};
		item.addEventListener('pointerenter', () => {
			content.querySelectorAll<HTMLElement>('.menu-item.selected').forEach((candidate) => {
				if (candidate !== item) candidate.classList.remove('selected');
			});
			item.classList.add('selected');
			openTimer = item.ownerDocument.defaultView?.setTimeout(open, 120) ?? 0;
		});
		item.addEventListener('pointerleave', () => {
			if (openTimer) item.ownerDocument.defaultView?.clearTimeout(openTimer);
			openTimer = 0;
		});
		item.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			open();
		});
		item.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			open();
		});
		const firstSeparator = content.querySelector(':scope > .menu-separator');
		if (firstSeparator) firstSeparator.before(item);
	}

	private applyPillAppearance(pill: HTMLElement, identity: OptionIdentity, scope?: HTMLElement): void {
		const host = scope ?? findBaseTableHost(pill);
		const store = host ? this.scopedStore(host) : this.store;
		const displayName = host ? getNativePropertyDisplayName(this.app, host, identity.propertyId) : undefined;
		const resolved = resolveColor(identity, store.get(identity)?.override, store.getPropertyStrategy(identity.propertyId, displayName), store.getPaletteTemplateId());
		const style = store.getPropertyStyle(identity.propertyId);
		setClass(pill, 'bpc-pill', true);
		pill.dataset.bpcKey = encodeOptionKey(identity);
		pill.title = identity.value;
		pill.setAttribute('aria-label', identity.value);
		if (resolved.kind === 'disabled') {
			setClass(pill, 'bpc-pill--colored', false);
			setClass(pill, 'bpc-pill--neutral', false);
			clearPillStyle(pill);
			clearPillVariables(pill);
			return;
		}
		setClass(pill, 'bpc-pill--colored', true);
		setClass(pill, 'bpc-pill--neutral', resolved.kind === 'neutral');
		applyPillStyle(pill, style);
		pill.style.setProperty('--bpc-bg', resolved.background);
		pill.style.setProperty('--bpc-bg-hover', resolved.hoverBackground);
		pill.style.setProperty('--bpc-fg-light', resolved.foregroundLight);
		pill.style.setProperty('--bpc-fg-dark', resolved.foregroundDark);
		pill.style.setProperty('--bpc-border', resolved.border);
		pill.style.setProperty('--bpc-accent', resolved.dot);
		pill.style.setProperty('--bpc-solid-bg', resolved.solidBackground);
		pill.style.setProperty('--bpc-solid-fg', resolved.solidForeground);
		pill.style.setProperty('--bpc-solid-bg-hover', resolved.solidHoverBackground);
		pill.style.setProperty('--pill-background', resolved.background);
		pill.style.setProperty('--pill-background-hover', resolved.hoverBackground);
	}

	private applyGroupHeadingAppearance(heading: HTMLElement, identity: OptionIdentity, scope?: HTMLElement): void {
		const host = scope ?? findBaseTableHost(heading);
		const store = host ? this.scopedStore(host) : this.store;
		const displayName = host ? getNativePropertyDisplayName(this.app, host, identity.propertyId) : undefined;
		const resolved = resolveColor(identity, store.get(identity)?.override, store.getPropertyStrategy(identity.propertyId, displayName), store.getPaletteTemplateId());
		const style = store.getPropertyStyle(identity.propertyId);
		setClass(heading, 'bpc-group-heading', true);
		heading.dataset.bpcKey = encodeOptionKey(identity);
		if (resolved.kind === 'disabled') {
			setClass(heading, 'bpc-group-heading--colored', false);
			setClass(heading, 'bpc-group-heading--neutral', false);
			clearPillStyle(heading);
			clearOptionColorVariables(heading);
			return;
		}
		setClass(heading, 'bpc-group-heading--colored', true);
		setClass(heading, 'bpc-group-heading--neutral', resolved.kind === 'neutral');
		applyPillStyle(heading, style);
		applyOptionColorVariables(heading, resolved);
	}

	private applyColumnAppearance(
		element: HTMLElement,
		scope: HTMLElement,
		propertyId: string,
	): void {
		const appearance = getNativeColumnAppearance(this.app, scope, propertyId);
		clearColumnAppearance(element);
		if (appearance.tone === 'default' && !appearance.bold) {
			this.columnAppearanceElements.delete(element);
			return;
		}
		element.classList.add('bpc-column-appearance', `bpc-column-tone-${appearance.tone}`);
		element.classList.toggle('bpc-column-emphasized', appearance.bold);
		if (appearance.tone === 'custom' && appearance.color) {
			element.style.setProperty('--bpc-column-color', appearance.color);
		}
		this.columnAppearanceElements.add(element);
	}

	private refreshColumnAppearances(scope: HTMLElement, onlyPropertyId?: string): void {
		for (const cell of scope.querySelectorAll<HTMLElement>(CELL_SELECTOR)) {
			const propertyId = this.propertyIdFor(scope, cell);
			if (!propertyId || (onlyPropertyId && propertyId !== onlyPropertyId)) continue;
			if (cell.closest('.bases-thead')) {
				clearColumnAppearance(cell);
				this.columnAppearanceElements.delete(cell);
			} else this.applyColumnAppearance(cell, scope, propertyId);
		}
	}

	private applyCellRule(cell: HTMLElement, propertyId: string): void {
		clearRuleAppearance(cell, 'bpc-rule-cell');
		const value = renderedCellValue(cell);
		const scope = findBaseTableHost(cell);
		const rules = scope ? this.scopedStore(scope).settings.rules : this.store.settings.rules;
		const rule = rules.find((candidate) =>
			candidate.enabled && candidate.target === 'cell' &&
			ruleHasFormatting(candidate) &&
			candidate.propertyId === propertyId && evaluateRule(candidate, value));
		if (rule) applyRuleAppearance(cell, 'bpc-rule-cell', rule, scope ? this.scopedStore(scope).getPaletteTemplateId() : this.store.getPaletteTemplateId());
	}

	private applyRowRule(row: HTMLElement): void {
		clearRuleAppearance(row, 'bpc-rule-row');
		const cells = [...row.querySelectorAll<HTMLElement>(CELL_SELECTOR)];
		const scope = findBaseTableHost(row);
		const rules = scope ? this.scopedStore(scope).settings.rules : this.store.settings.rules;
		for (const rule of rules) {
			if (!rule.enabled || rule.target !== 'row' || !ruleHasFormatting(rule)) continue;
			const cell = cells.find((candidate) =>
				(scope ? this.propertyIdFor(scope, candidate) : candidate.dataset.property?.trim()) === rule.propertyId);
			if (cell && evaluateRule(rule, renderedCellValue(cell))) {
				applyRuleAppearance(row, 'bpc-rule-row', rule, scope ? this.scopedStore(scope).getPaletteTemplateId() : this.store.getPaletteTemplateId());
				return;
			}
		}
	}

	private untrackCell(cell: HTMLElement): void {
		this.visibleCells.delete(cell);
		cell.classList.remove('bpc-main-column');
		clearRuleAppearance(cell, 'bpc-rule-cell');
		clearColumnAppearance(cell);
		this.columnAppearanceElements.delete(cell);
	}

	private untrackRow(row: HTMLElement): void {
		this.visibleRows.delete(row);
		clearRuleAppearance(row, 'bpc-rule-row');
	}

	private untrackGroupHeading(heading: HTMLElement): void {
		const metadata = this.trackedGroups.get(heading);
		if (!metadata) return;
		const elements = this.visibleGroupsByKey.get(metadata.key);
		elements?.delete(heading);
		if (elements?.size === 0) this.visibleGroupsByKey.delete(metadata.key);
		heading.classList.remove('bpc-group-heading', 'bpc-group-heading--colored', 'bpc-group-heading--neutral');
		clearPillStyle(heading);
		delete heading.dataset.bpcKey;
		clearOptionColorVariables(heading);
		this.trackedGroups.delete(heading);
	}

	private untrackPill(pill: HTMLElement): void {
		const metadata = this.tracked.get(pill);
		if (!metadata) return;
		const elements = this.visibleByKey.get(metadata.key);
		elements?.delete(pill);
		if (elements?.size === 0) this.visibleByKey.delete(metadata.key);
		for (const [root, binding] of this.roots) {
			if (binding.activePill === pill) this.setActivePill(root, null);
		}
		pill.classList.remove('bpc-pill', 'bpc-pill--colored', 'bpc-pill--neutral', 'bpc-pill--active');
		clearPillStyle(pill);
		delete pill.dataset.bpcKey;
		clearPillVariables(pill);
		restoreAttribute(pill, 'title', metadata.originalTitle);
		restoreAttribute(pill, 'aria-label', metadata.originalAriaLabel);
		this.tracked.delete(pill);
	}

	private refreshFromStore(): void {
		for (const elements of [...this.visibleByKey.values()]) for (const pill of [...elements]) {
			if (pill.isConnected) this.processPill(pill);
		}
		for (const elements of [...this.visibleGroupsByKey.values()]) for (const heading of [...elements]) {
			if (heading.isConnected) this.processGroupHeading(heading);
		}
		for (const cell of this.visibleCells) {
			if (cell.isConnected) this.processCell(cell);
			else this.visibleCells.delete(cell);
		}
		for (const row of this.visibleRows) {
			if (row.isConnected) this.processRow(row);
			else this.visibleRows.delete(row);
		}
	}

	private propertyIdFor(scope: HTMLElement, source: string | Element): string | null {
		const native = resolveNativePropertyId(this.app, scope, source);
		if (!native) return null;
		return this.baseStores?.resolvePropertyId(scope, native) ?? native;
	}

	private scopedStore(scope: HTMLElement): SettingsStore {
		const store = this.storeForScope(scope);
		if (store !== this.store && !this.scopedStoreUnsubscribers.has(store)) {
			this.scopedStoreUnsubscribers.set(store, store.subscribe(() => this.refreshFromStore()));
		}
		return store;
	}

}

export function renderedCellValue(cell: HTMLElement): { text: string; values: string[] } {
	const pills = [...cell.querySelectorAll<HTMLElement>('.multi-select-pill-content')]
		.map((pill) => pill.textContent?.trim() ?? '');
	if (pills.length) return { text: pills.join(', '), values: pills };
	const input = cell.querySelector<HTMLInputElement>('input');
	if (input?.type === 'checkbox') {
		const value = input.checked ? 'true' : 'false';
		return { text: value, values: [value] };
	}
	const checkbox = cell.querySelector<HTMLElement>('[role="checkbox"][aria-checked]');
	if (checkbox) {
		const value = checkbox.getAttribute('aria-checked') === 'true' ? 'true' : 'false';
		return { text: value, values: [value] };
	}
	if (input) return { text: input.value.trim(), values: [input.value.trim()] };
	const text = cell.textContent?.trim() ?? '';
	return { text, values: [text] };
}

function applyRuleAppearance(element: HTMLElement, className: string, rule: ConditionalRule, paletteId?: PaletteTemplateId): void {
	const color = ruleColorVariables(rule.color, rule.fontColor, paletteId, rule.backgroundOpacity);
	element.classList.add(className);
	element.classList.toggle('bpc-rule-has-background', Boolean(rule.color));
	element.classList.toggle('bpc-rule-has-foreground', Boolean(rule.color || rule.fontColor));
	element.classList.toggle('bpc-rule-bold', rule.bold === true);
	element.classList.toggle('bpc-rule-strikethrough', rule.strikethrough === true);
	element.classList.toggle('bpc-rule-override-pills', Boolean(rule.color && rule.overridePillColors));
	element.dataset.bpcRuleId = rule.id;
	element.style.setProperty('--bpc-rule-bg', color.background);
	element.style.setProperty('--bpc-rule-bg-hover', color.hover);
	element.style.setProperty('--bpc-rule-fg-light', color.foregroundLight);
	element.style.setProperty('--bpc-rule-fg-dark', color.foregroundDark);
}

function clearRuleAppearance(element: HTMLElement, className: string): void {
	element.classList.remove(
		className,
		'bpc-rule-has-background',
		'bpc-rule-has-foreground',
		'bpc-rule-bold',
		'bpc-rule-strikethrough',
		'bpc-rule-override-pills',
	);
	delete element.dataset.bpcRuleId;
	element.style.removeProperty('--bpc-rule-bg');
	element.style.removeProperty('--bpc-rule-bg-hover');
	element.style.removeProperty('--bpc-rule-fg-light');
	element.style.removeProperty('--bpc-rule-fg-dark');
}

function leafContainer(leaf: WorkspaceLeaf): HTMLElement | null {
	const view = leaf.view as typeof leaf.view & { containerEl?: HTMLElement };
	return view.containerEl?.nodeType === 1 ? view.containerEl : null;
}

function asElement(value: unknown): Element | null {
	if (typeof value !== 'object' || value === null) return null;
	return 'nodeType' in value && value.nodeType === 1 ? value as Element : null;
}

interface TreeBuckets {
	pills: HTMLElement[];
	cells: HTMLElement[];
	rows: HTMLElement[];
	groups: HTMLElement[];
	tables: HTMLElement[];
	toolbars: HTMLElement[];
	controls: HTMLElement[];
}

function collectTreeBuckets(root: Element): TreeBuckets {
	const buckets: TreeBuckets = {
		pills: [], cells: [], rows: [], groups: [], tables: [], toolbars: [], controls: [],
	};
	const elements = [root, ...root.querySelectorAll<HTMLElement>(TREE_SELECTOR)];
	for (const candidate of elements) {
		const element = candidate as HTMLElement;
		if (element.matches(PILL_SELECTOR)) buckets.pills.push(element);
		if (element.matches(CELL_SELECTOR)) buckets.cells.push(element);
		if (element.matches(ROW_SELECTOR)) buckets.rows.push(element);
		if (element.matches(GROUP_HEADING_SELECTOR)) buckets.groups.push(element);
		if (element.matches(TABLE_SELECTOR)) buckets.tables.push(element);
		if (element.matches(TOOLBAR_SELECTOR)) buckets.toolbars.push(element);
		if (element.matches(TOOLBAR_CONTROL_SELECTOR)) buckets.controls.push(element);
	}
	return buckets;
}

function mutationElement(node: Node): Element | null {
	return asElement(node) ?? node.parentElement;
}

function deduplicateRoots(elements: readonly Element[]): Element[] {
	const unique = [...new Set(elements)];
	return unique.filter((candidate) => !unique.some((other) =>
		other !== candidate && other.contains(candidate)));
}

function belongsToRoot(root: HTMLElement, element: HTMLElement): boolean {
	return root === element || root.contains(element);
}

function isTextEditingTarget(target: Element | null, activePill: HTMLElement): boolean {
	if (target?.closest('input, textarea, select')) return true;
	const editable = target?.closest<HTMLElement>('[contenteditable]:not([contenteditable="false"])');
	return Boolean(editable && !editable.contains(activePill));
}

function clearPillVariables(element: HTMLElement): void {
	for (const variable of [
		'--bpc-bg', '--bpc-bg-hover', '--bpc-fg-light', '--bpc-fg-dark',
		'--bpc-border',
		'--bpc-accent', '--bpc-solid-bg', '--bpc-solid-fg', '--bpc-solid-bg-hover',
		'--pill-background', '--pill-background-hover',
	]) element.style.removeProperty(variable);
}

function applyOptionColorVariables(
	element: HTMLElement,
	color: Exclude<ReturnType<typeof resolveColor>, { kind: 'disabled' }>,
): void {
	element.style.setProperty('--bpc-bg', color.background);
	element.style.setProperty('--bpc-bg-hover', color.hoverBackground);
	element.style.setProperty('--bpc-fg-light', color.foregroundLight);
	element.style.setProperty('--bpc-fg-dark', color.foregroundDark);
	element.style.setProperty('--bpc-border', color.border);
	element.style.setProperty('--bpc-accent', color.dot);
	element.style.setProperty('--bpc-solid-bg', color.solidBackground);
	element.style.setProperty('--bpc-solid-fg', color.solidForeground);
	element.style.setProperty('--bpc-solid-bg-hover', color.solidHoverBackground);
}

function clearOptionColorVariables(element: HTMLElement): void {
	for (const variable of ['--bpc-bg', '--bpc-bg-hover', '--bpc-fg-light', '--bpc-fg-dark', '--bpc-border', '--bpc-accent', '--bpc-solid-bg', '--bpc-solid-fg', '--bpc-solid-bg-hover']) {
		element.style.removeProperty(variable);
	}
}

function applyPillStyle(element: HTMLElement, style: 'soft' | 'solid' | 'outline'): void {
	const targetClass = `bpc-pill-style-${style}`;
	if (
		element.classList.contains(targetClass) &&
		['soft', 'solid', 'outline'].every((candidate) =>
			candidate === style || !element.classList.contains(`bpc-pill-style-${candidate}`))
	) return;
	clearPillStyle(element);
	element.classList.add(targetClass);
}

function clearPillStyle(element: HTMLElement): void {
	for (const className of ['bpc-pill-style-soft', 'bpc-pill-style-solid', 'bpc-pill-style-outline']) {
		setClass(element, className, false);
	}
}

function setClass(element: HTMLElement, className: string, enabled: boolean): void {
	if (element.classList.contains(className) === enabled) return;
	element.classList.toggle(className, enabled);
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null): void {
	if (value === null) element.removeAttribute(name);
	else element.setAttribute(name, value);
}

function clearColumnAppearance(element: HTMLElement): void {
	element.classList.remove(
		'bpc-column-appearance',
		'bpc-column-tone-default',
		'bpc-column-tone-muted',
		'bpc-column-tone-faint',
		'bpc-column-tone-custom',
		'bpc-column-emphasized',
	);
	element.style.removeProperty('--bpc-column-color');
}

function describeColumnAppearance(appearance: NativeColumnAppearance): string {
	const tone = appearance.tone === 'default'
		? ''
		: appearance.tone === 'custom'
			? 'Custom'
			: appearance.tone[0]?.toLocaleUpperCase() + appearance.tone.slice(1);
	return [tone, appearance.bold ? 'Bold' : ''].filter(Boolean).join(' + ') || 'Default';
}

function describePillAppearance(store: SettingsStore, propertyId: string, displayName: string): string {
	const strategy = strategyLabel(store.getPropertyStrategy(propertyId, displayName));
	const style = ({ soft: 'Soft', solid: 'Solid', outline: 'Outline' })[store.getPropertyStyle(propertyId)];
	return `${strategy} · ${style}`;
}

function findToolbarInsertionAnchor(toolbar: HTMLElement): Element | null {
	const nativeSort = toolbar.querySelector('.bases-toolbar-sort-menu');
	if (nativeSort) return nativeSort;

	const accessibleSort = [...toolbar.querySelectorAll<HTMLElement>('[aria-label], [title]')]
		.find((element) => {
			const label = element.getAttribute('aria-label') ?? element.title;
			return label.trim().toLocaleLowerCase() === 'sort';
		});
	if (accessibleSort) {
		return accessibleSort.closest('.bases-toolbar-item') ?? accessibleSort;
	}

	return toolbar.querySelector(
		'.bases-toolbar-item:not(.bases-toolbar-views-menu):not(.bases-toolbar-result-count)',
	);
}

function findBaseTableHost(element: HTMLElement): HTMLElement | null {
	return element.closest<HTMLElement>('.bases-embed')
		?? element.closest<HTMLElement>('.workspace-leaf-content[data-type="bases"]')
		?? element.closest<HTMLElement>('.view-content')
		?? element.closest<HTMLElement>('.bases-view');
}

function groupPropertyId(app: App, scope: HTMLElement | null, heading: HTMLElement): string | null {
	const native = scope ? getNativeGroupProperty(app, scope) : null;
	if (native) return native;
	const fromDom = heading.dataset.property?.trim()
		?? heading.querySelector<HTMLElement>('.bases-group-property[data-property]')?.dataset.property?.trim()
		?? heading.closest<HTMLElement>('[data-property]')?.dataset.property?.trim();
	return fromDom || null;
}

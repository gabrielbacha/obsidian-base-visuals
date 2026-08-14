import { setIcon, type App, type EventRef, type WorkspaceLeaf } from 'obsidian';
import { encodeOptionKey, resolveColor } from './colors';
import {
	getNativeColumnAppearance,
	getNativeColumnHeaders,
	getNativeGroupProperty,
	getNativeMainProperty,
	type NativeColumnAppearance,
} from './native-table-view';
import { evaluateRule, ruleColorVariables } from './rules';
import { SettingsStore } from './settings-store';
import { ConditionalRule, OptionIdentity } from './types';
import { TableLayoutPopover } from '../ui/table-layout-popover';
import { ColumnAppearancePopover } from '../ui/column-appearance-popover';

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
	contextMenuHandler: (event: MouseEvent) => void;
}

export type OpenRuleManager = (propertyIds: string[]) => void;
export interface ColumnMenuRequest {
	document: Document;
	point: { x: number; y: number };
	propertyId: string;
	value: string;
	values: string[];
	removeFromRow: () => void;
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
	private readonly pendingMenuObservers = new Set<MutationObserver>();
	private readonly mainPropertyByTable = new WeakMap<HTMLElement, string>();
	private readonly tableLayoutPopover: TableLayoutPopover;
	private readonly columnAppearancePopover: ColumnAppearancePopover;
	private unsubscribeStore: (() => void) | null = null;
	private previousOverrides = new Map<string, string>();
	private started = false;

	constructor(
		private readonly app: App,
		private readonly store: SettingsStore,
		private readonly openRuleManager: OpenRuleManager = () => undefined,
		private readonly openColumnManager: OpenColumnManager = () => undefined,
	) {
		this.tableLayoutPopover = new TableLayoutPopover(app, store);
		this.columnAppearancePopover = new ColumnAppearancePopover(app);
	}

	start(registerEvent: (eventRef: EventRef) => void): void {
		if (this.started) return;
		this.started = true;
		this.unsubscribeStore = this.store.subscribe(() => this.refreshFromStore());
		this.previousOverrides = this.overrideSnapshot();
		registerEvent(this.app.workspace.on('layout-change', () => this.refreshRoots()));
		registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshRoots()));
		this.refreshRoots();
	}

	observeRoot(root: HTMLElement): void {
		if (this.roots.has(root)) return;
		const Observer = root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
		const observer = new Observer((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.removedNodes)) this.untrackTree(node);
				for (const node of Array.from(mutation.addedNodes)) this.processTree(node);
				const target = asElement(mutation.target);
				if (target) this.refreshAround(target);
			}
		});
		observer.observe(root, {
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
			attributeFilter: ['data-property', 'aria-checked'],
		});

		const inputHandler = (event: Event) => {
			const target = asElement(event.target);
			if (target) this.refreshAround(target);
		};
		const contextMenuHandler = (event: MouseEvent) => this.handleContextMenu(event);
		root.addEventListener('input', inputHandler);
		root.addEventListener('change', inputHandler);
		root.addEventListener('contextmenu', contextMenuHandler, true);
		this.roots.set(root, { observer, inputHandler, contextMenuHandler });
		this.processTree(root);
	}

	stop(): void {
		this.started = false;
		this.unsubscribeStore?.();
		this.unsubscribeStore = null;
		for (const root of [...this.roots.keys()]) this.detachRoot(root);
		this.visibleByKey.clear();
		this.visibleGroupsByKey.clear();
		this.visibleRows.clear();
		this.visibleCells.clear();
		this.tableValues.clear();
		this.tables.clear();
		this.tableLayoutPopover.close();
		this.columnAppearancePopover.close();
		for (const observer of this.pendingMenuObservers) observer.disconnect();
		this.pendingMenuObservers.clear();
		for (const element of this.columnAppearanceElements) clearColumnAppearance(element);
		this.columnAppearanceElements.clear();
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
		root.removeEventListener('input', binding.inputHandler);
		root.removeEventListener('change', binding.inputHandler);
		root.removeEventListener('contextmenu', binding.contextMenuHandler, true);
		this.untrackTree(root);
		for (const host of this.tableValues.keys()) {
			if (host === root || root.contains(host)) this.tableValues.delete(host);
		}
		root.querySelectorAll<HTMLElement>(TOOLBAR_CONTROL_SELECTOR).forEach((button) => button.remove());
		root.querySelectorAll<HTMLElement>('.bpc-table').forEach((table) => this.untrackTable(table));
		root.querySelectorAll<HTMLElement>('.bpc-column-appearance').forEach((element) => {
			clearColumnAppearance(element);
			this.columnAppearanceElements.delete(element);
		});
		this.roots.delete(root);
	}

	private processTree(node: Node): void {
		const element = asElement(node);
		if (!element) return;
		this.processMatches(element, PILL_SELECTOR, (item) => this.processPill(item));
		this.processMatches(element, CELL_SELECTOR, (item) => this.processCell(item));
		this.processMatches(element, ROW_SELECTOR, (item) => this.processRow(item));
		this.processMatches(element, GROUP_HEADING_SELECTOR, (item) => this.processGroupHeading(item));
		this.processMatches(element, TABLE_SELECTOR, (item) => this.processTable(item));
		this.processMatches(element, TOOLBAR_SELECTOR, (item) => this.processToolbar(item));
		const ancestorPill = element.closest<HTMLElement>(PILL_SELECTOR);
		if (ancestorPill) this.processPill(ancestorPill);
		const ancestorGroup = element.closest<HTMLElement>(GROUP_HEADING_SELECTOR);
		if (ancestorGroup) this.processGroupHeading(ancestorGroup);
	}

	private processMatches(element: Element, selector: string, action: (item: HTMLElement) => void): void {
		if (element.matches(selector)) action(element as HTMLElement);
		element.querySelectorAll<HTMLElement>(selector).forEach(action);
	}

	private untrackTree(node: Node): void {
		const element = asElement(node);
		if (!element) return;
		this.processMatches(element, PILL_SELECTOR, (item) => this.untrackPill(item));
		this.processMatches(element, CELL_SELECTOR, (item) => this.untrackCell(item));
		this.processMatches(element, ROW_SELECTOR, (item) => this.untrackRow(item));
		this.processMatches(element, GROUP_HEADING_SELECTOR, (item) => this.untrackGroupHeading(item));
		this.processMatches(element, TABLE_SELECTOR, (item) => this.untrackTable(item));
		for (const host of this.tableValues.keys()) {
			if (host === element || element.contains(host)) this.tableValues.delete(host);
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

	private processCell(cell: HTMLElement): void {
		const scope = findBaseTableHost(cell);
		if (!scope) return;
		const propertyId = cell.dataset.property?.trim();
		if (!propertyId) return;
		this.visibleCells.add(cell);
		this.store.discoverProperty(propertyId);
		this.applyCellRule(cell, propertyId);
		if (cell.closest('.bases-thead')) {
			clearColumnAppearance(cell);
			this.columnAppearanceElements.delete(cell);
		} else this.applyColumnAppearance(cell, scope, propertyId);
		const table = cell.closest<HTMLElement>(TABLE_SELECTOR);
		if (table) this.applyMainColumn(table, cell);
		scope.querySelectorAll<HTMLElement>(TOOLBAR_SELECTOR).forEach((toolbar) => this.processToolbar(toolbar));
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
		const propertyId = groupPropertyId(this.app, scope, heading);
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
		this.store.ensure(identity);
		this.applyGroupHeadingAppearance(heading, identity);
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
			'Conditional formatting',
			() => this.openRuleManager(this.propertyIdsInScope(scope)),
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
		if (existing) return existing;
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
		return item;
	}

	private processTable(table: HTMLElement): void {
		if (!table.closest(BASE_SCOPE_SELECTOR)) return;
		table.classList.add('bpc-table');
		this.tables.add(table);
		const scope = findBaseTableHost(table);
		const primary = scope ? getNativeMainProperty(this.app, scope) : null;
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
		cell.classList.toggle(
			'bpc-main-column',
			Boolean(primary) && cell.dataset.property?.trim() === primary,
		);
	}

	private untrackTable(table: HTMLElement): void {
		table.classList.remove('bpc-table');
		table.querySelectorAll<HTMLElement>('.bpc-main-column').forEach((cell) =>
			cell.classList.remove('bpc-main-column'));
		table.querySelectorAll<HTMLElement>('.bpc-column-appearance').forEach((element) => {
			clearColumnAppearance(element);
			this.columnAppearanceElements.delete(element);
		});
		this.tables.delete(table);
	}

	private propertyIdsInScope(scope: HTMLElement): string[] {
		return [...new Set([...scope.querySelectorAll<HTMLElement>(CELL_SELECTOR)]
			.map((cell) => cell.dataset.property?.trim())
			.filter((value): value is string => Boolean(value)))];
	}

	private processPill(pill: HTMLElement): void {
		if (!pill.closest(BASE_SCOPE_SELECTOR)) {
			this.untrackPill(pill);
			return;
		}
		const propertyId = pill.closest<HTMLElement>(CELL_SELECTOR)?.dataset.property?.trim();
		const value = pill.querySelector<HTMLElement>('.multi-select-pill-content')?.textContent?.trim() ?? '';
		if (!propertyId || !value) {
			this.untrackPill(pill);
			return;
		}

		const identity = { propertyId, value };
		const host = findBaseTableHost(pill);
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
		this.store.ensure(identity);
		this.applyPillAppearance(pill, identity);
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
		const removeButton = pill.querySelector<HTMLElement>('.multi-select-pill-remove-button');
		this.openColumnManager({
			document: pill.ownerDocument,
			point: { x: event.clientX, y: event.clientY },
			propertyId: metadata.identity.propertyId,
			value: metadata.identity.value,
			values: [...(this.tableValues.get(host)?.get(metadata.identity.propertyId) ?? [])]
				.sort((first, second) => first.localeCompare(second)),
			removeFromRow: () => removeButton?.click(),
		});
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
			header.propertyId,
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
			this.injectColumnAppearanceMenuItem(menu, headerCell, scope, propertyId);
			finish();
			return true;
		};
		observer = new Observer(() => inject());
		observer.observe(doc.body, { childList: true, subtree: true });
		this.pendingMenuObservers.add(observer);
		timeout = doc.defaultView?.setTimeout(finish, 750) ?? 0;
	}

	private injectColumnAppearanceMenuItem(
		menu: HTMLElement,
		headerCell: HTMLElement,
		scope: HTMLElement,
		propertyId: string,
	): void {
		if (menu.querySelector('.bpc-column-appearance-menu-item')) return;
		const appearance = getNativeColumnAppearance(this.app, scope, propertyId);
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

	private applyPillAppearance(pill: HTMLElement, identity: OptionIdentity): void {
		const resolved = resolveColor(identity, this.store.get(identity)?.override);
		pill.classList.add('bpc-pill');
		pill.dataset.bpcKey = encodeOptionKey(identity);
		pill.title = identity.value;
		pill.setAttribute('aria-label', identity.value);
		if (resolved.kind === 'disabled') {
			pill.classList.remove('bpc-pill--colored');
			clearPillVariables(pill);
			return;
		}
		pill.classList.add('bpc-pill--colored');
		pill.style.setProperty('--bpc-bg', resolved.background);
		pill.style.setProperty('--bpc-bg-hover', resolved.hoverBackground);
		pill.style.setProperty('--bpc-fg-light', resolved.foregroundLight);
		pill.style.setProperty('--bpc-fg-dark', resolved.foregroundDark);
		pill.style.setProperty('--pill-background', resolved.background);
		pill.style.setProperty('--pill-background-hover', resolved.hoverBackground);
	}

	private applyGroupHeadingAppearance(heading: HTMLElement, identity: OptionIdentity): void {
		const resolved = resolveColor(identity, this.store.get(identity)?.override);
		heading.classList.add('bpc-group-heading');
		heading.dataset.bpcKey = encodeOptionKey(identity);
		if (resolved.kind === 'disabled') {
			heading.classList.remove('bpc-group-heading--colored');
			clearOptionColorVariables(heading);
			return;
		}
		heading.classList.add('bpc-group-heading--colored');
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
			const propertyId = cell.dataset.property?.trim();
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
		const rule = this.store.settings.rules.find((candidate) =>
			candidate.enabled && candidate.target === 'cell' &&
			candidate.propertyId === propertyId && evaluateRule(candidate, value));
		if (rule) applyRuleAppearance(cell, 'bpc-rule-cell', rule);
	}

	private applyRowRule(row: HTMLElement): void {
		clearRuleAppearance(row, 'bpc-rule-row');
		const cells = [...row.querySelectorAll<HTMLElement>(CELL_SELECTOR)];
		for (const rule of this.store.settings.rules) {
			if (!rule.enabled || rule.target !== 'row') continue;
			const cell = cells.find((candidate) => candidate.dataset.property?.trim() === rule.propertyId);
			if (cell && evaluateRule(rule, renderedCellValue(cell))) {
				applyRuleAppearance(row, 'bpc-rule-row', rule);
				return;
			}
		}
	}

	private untrackCell(cell: HTMLElement): void {
		this.visibleCells.delete(cell);
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
		heading.classList.remove('bpc-group-heading', 'bpc-group-heading--colored');
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
		pill.classList.remove('bpc-pill', 'bpc-pill--colored');
		delete pill.dataset.bpcKey;
		clearPillVariables(pill);
		restoreAttribute(pill, 'title', metadata.originalTitle);
		restoreAttribute(pill, 'aria-label', metadata.originalAriaLabel);
		this.tracked.delete(pill);
	}

	private refreshFromStore(): void {
		const next = this.overrideSnapshot();
		const keys = new Set([...this.previousOverrides.keys(), ...next.keys()]);
		for (const key of keys) {
			if (this.previousOverrides.get(key) === next.get(key)) continue;
			for (const pill of this.visibleByKey.get(key) ?? []) {
				const metadata = this.tracked.get(pill);
				if (metadata) this.applyPillAppearance(pill, metadata.identity);
			}
			for (const heading of this.visibleGroupsByKey.get(key) ?? []) {
				const metadata = this.trackedGroups.get(heading);
				if (metadata) this.applyGroupHeadingAppearance(heading, metadata.identity);
			}
		}
		this.previousOverrides = next;
		for (const cell of this.visibleCells) {
			if (cell.isConnected) this.processCell(cell);
			else this.visibleCells.delete(cell);
		}
		for (const row of this.visibleRows) {
			if (row.isConnected) this.processRow(row);
			else this.visibleRows.delete(row);
		}
	}

	private overrideSnapshot(): Map<string, string> {
		const snapshot = new Map<string, string>();
		for (const [key, option] of Object.entries(this.store.settings.options)) {
			snapshot.set(key, JSON.stringify(option.override ?? null));
		}
		return snapshot;
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

function applyRuleAppearance(element: HTMLElement, className: string, rule: ConditionalRule): void {
	const color = ruleColorVariables(rule.color);
	element.classList.add(className);
	element.dataset.bpcRuleId = rule.id;
	element.style.setProperty('--bpc-rule-bg', color.background);
	element.style.setProperty('--bpc-rule-bg-hover', color.hover);
}

function clearRuleAppearance(element: HTMLElement, className: string): void {
	element.classList.remove(className);
	delete element.dataset.bpcRuleId;
	element.style.removeProperty('--bpc-rule-bg');
	element.style.removeProperty('--bpc-rule-bg-hover');
}

function leafContainer(leaf: WorkspaceLeaf): HTMLElement | null {
	const view = leaf.view as typeof leaf.view & { containerEl?: HTMLElement };
	return view.containerEl?.nodeType === 1 ? view.containerEl : null;
}

function asElement(value: unknown): Element | null {
	if (typeof value !== 'object' || value === null) return null;
	return 'nodeType' in value && value.nodeType === 1 ? value as Element : null;
}

function clearPillVariables(element: HTMLElement): void {
	for (const variable of [
		'--bpc-bg', '--bpc-bg-hover', '--bpc-fg-light', '--bpc-fg-dark',
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
}

function clearOptionColorVariables(element: HTMLElement): void {
	for (const variable of ['--bpc-bg', '--bpc-bg-hover', '--bpc-fg-light', '--bpc-fg-dark']) {
		element.style.removeProperty(variable);
	}
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
	const fromDom = heading.dataset.property?.trim()
		?? heading.querySelector<HTMLElement>('.bases-group-property[data-property]')?.dataset.property?.trim()
		?? heading.closest<HTMLElement>('[data-property]')?.dataset.property?.trim();
	if (fromDom) return fromDom;
	return scope ? getNativeGroupProperty(app, scope) : null;
}

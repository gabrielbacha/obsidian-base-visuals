import type { App, EventRef, WorkspaceLeaf } from 'obsidian';
import { encodeOptionKey, resolveColor } from './colors';
import { evaluateRule, ruleColorVariables } from './rules';
import { SettingsStore } from './settings-store';
import { ConditionalRule, OptionIdentity } from './types';
import { ColorPopover } from '../ui/color-popover';

const PILL_SELECTOR = '.multi-select-pill';
const BASE_SCOPE_SELECTOR = '.bases-view, .bases-embed';
const CELL_SELECTOR = '.bases-td[data-property], .bases-table-cell[data-property]';
const ROW_SELECTOR = '.bases-tr';
const TOOLBAR_SELECTOR = '.bases-toolbar, .query-toolbar';

interface TrackedPill {
	identity: OptionIdentity;
	key: string;
	originalTitle: string | null;
	originalAriaLabel: string | null;
}

interface RootBinding {
	observer: MutationObserver;
	contextMenuHandler: (event: MouseEvent) => void;
	inputHandler: (event: Event) => void;
}

export type OpenRuleManager = (propertyIds: string[]) => void;

export class PillEnhancer {
	private readonly roots = new Map<HTMLElement, RootBinding>();
	private readonly tracked = new WeakMap<HTMLElement, TrackedPill>();
	private readonly visibleByKey = new Map<string, Set<HTMLElement>>();
	private readonly visibleRows = new Set<HTMLElement>();
	private readonly visibleCells = new Set<HTMLElement>();
	private unsubscribeStore: (() => void) | null = null;
	private previousOverrides = new Map<string, string>();
	private started = false;

	constructor(
		private readonly app: App,
		private readonly store: SettingsStore,
		private readonly popover: ColorPopover,
		private readonly openRuleManager: OpenRuleManager = () => undefined,
	) {}

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

		const contextMenuHandler = (event: MouseEvent) => {
			const pill = asElement(event.target)?.closest<HTMLElement>('.bpc-pill');
			if (!pill || !root.contains(pill)) return;
			const metadata = this.tracked.get(pill);
			if (!metadata) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			this.popover.openAtPoint(
				pill.ownerDocument,
				{ x: event.clientX, y: event.clientY },
				metadata.identity,
			);
		};
		const inputHandler = (event: Event) => {
			const target = asElement(event.target);
			if (target) this.refreshAround(target);
		};
		root.addEventListener('contextmenu', contextMenuHandler, true);
		root.addEventListener('input', inputHandler);
		root.addEventListener('change', inputHandler);
		this.roots.set(root, { observer, contextMenuHandler, inputHandler });
		this.processTree(root);
	}

	stop(): void {
		this.started = false;
		this.unsubscribeStore?.();
		this.unsubscribeStore = null;
		for (const root of [...this.roots.keys()]) this.detachRoot(root);
		this.popover.close();
		this.visibleByKey.clear();
		this.visibleRows.clear();
		this.visibleCells.clear();
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
		root.removeEventListener('contextmenu', binding.contextMenuHandler, true);
		root.removeEventListener('input', binding.inputHandler);
		root.removeEventListener('change', binding.inputHandler);
		this.untrackTree(root);
		root.querySelectorAll<HTMLElement>('.bpc-conditional-formatting-button').forEach((button) => button.remove());
		this.roots.delete(root);
	}

	private processTree(node: Node): void {
		const element = asElement(node);
		if (!element) return;
		this.processMatches(element, PILL_SELECTOR, (item) => this.processPill(item));
		this.processMatches(element, CELL_SELECTOR, (item) => this.processCell(item));
		this.processMatches(element, ROW_SELECTOR, (item) => this.processRow(item));
		this.processMatches(element, TOOLBAR_SELECTOR, (item) => this.processToolbar(item));
		const ancestorPill = element.closest<HTMLElement>(PILL_SELECTOR);
		if (ancestorPill) this.processPill(ancestorPill);
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
	}

	private processCell(cell: HTMLElement): void {
		const scope = cell.closest<HTMLElement>(BASE_SCOPE_SELECTOR);
		if (!scope) return;
		const propertyId = cell.dataset.property?.trim();
		if (!propertyId) return;
		this.visibleCells.add(cell);
		this.store.discoverProperty(propertyId);
		this.applyCellRule(cell, propertyId);
		scope.querySelectorAll<HTMLElement>(TOOLBAR_SELECTOR).forEach((toolbar) => this.processToolbar(toolbar));
	}

	private processRow(row: HTMLElement): void {
		if (!row.closest(BASE_SCOPE_SELECTOR)) return;
		this.visibleRows.add(row);
		this.applyRowRule(row);
	}

	private processToolbar(toolbar: HTMLElement): void {
		if (toolbar.querySelector('.bpc-conditional-formatting-button')) return;
		const scope = toolbar.closest<HTMLElement>(BASE_SCOPE_SELECTOR);
		if (!scope?.querySelector(CELL_SELECTOR)) return;
		const button = toolbar.createEl('button');
		button.type = 'button';
		button.className = 'text-icon-button bases-toolbar-item bpc-conditional-formatting-button';
		button.setAttribute('aria-label', 'Conditional formatting');
		button.title = 'Conditional formatting';
		createPaletteIcon(button);
		button.createSpan({ cls: 'text-button-label', text: 'Conditional formatting' });
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.openRuleManager(this.propertyIdsInScope(scope));
		});
		button.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			button.click();
		});

		const anchor = findToolbarInsertionAnchor(toolbar);
		const parent = anchor?.parentElement ?? toolbar;
		parent.insertBefore(button, anchor ?? parent.firstChild);
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
	}

	private untrackRow(row: HTMLElement): void {
		this.visibleRows.delete(row);
		clearRuleAppearance(row, 'bpc-rule-row');
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

function restoreAttribute(element: HTMLElement, name: string, value: string | null): void {
	if (value === null) element.removeAttribute(name);
	else element.setAttribute(name, value);
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

function createPaletteIcon(button: HTMLButtonElement): void {
	const icon = button.createSpan({ cls: 'text-button-icon bpc-toolbar-palette-icon' });
	const svg = icon.createSvg('svg', {
		cls: ['svg-icon', 'lucide-palette'],
		attr: {
			viewBox: '0 0 24 24',
			width: '18',
			height: '18',
			fill: 'none',
			stroke: 'currentColor',
			'stroke-width': '2',
			'stroke-linecap': 'round',
			'stroke-linejoin': 'round',
			'aria-hidden': 'true',
		},
	});
	svg.createSvg('path', {
		attr: { d: 'M12 22a10 10 0 1 0-10-10 4 4 0 0 0 4 4h1.6a2 2 0 0 1 1.6 3.2l-.4.6A2 2 0 0 0 10.4 22Z' },
	});
	const dots: Array<[string, string]> = [
		['13.5', '6.5'], ['17.5', '10.5'], ['8.5', '7.5'], ['6.5', '12.5'],
	];
	for (const [cx, cy] of dots) {
		svg.createSvg('circle', {
			attr: { cx, cy, r: '.5', fill: 'currentColor' },
		});
	}
}

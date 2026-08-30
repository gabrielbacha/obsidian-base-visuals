import { App, Modal, setIcon } from 'obsidian';
import { normalizeHex, palettePresetName, paletteTemplate, resolvePreset, resolveRuleColor } from '../core/colors';
import { OPERATOR_LABELS, operatorNeedsOperand } from '../core/rules';
import { SettingsStore } from '../core/settings-store';
import {
	ConditionalRule,
	RULE_OPERATORS,
	RuleColor,
} from '../core/types';
import { displayPropertyName } from './color-popover';

export class RuleManagerModal extends Modal {
	private view: RuleManagerView | null = null;

	constructor(
		app: App,
		private readonly store: SettingsStore,
		private readonly priorityProperties: string[] = [],
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('bpc-rule-modal');
		this.setTitle('Conditional formatting');
		this.view = new RuleManagerView(this.app, this.store, this.priorityProperties);
		this.view.mount(this.contentEl);
	}

	onClose(): void {
		this.view?.unmount();
		this.view = null;
		this.contentEl.empty();
	}
}

export class RuleManagerView {
	private container: HTMLElement | null = null;
	private unsubscribe: (() => void) | null = null;
	private popover: RuleColorPopover | null = null;
	private draggedRuleId: string | null = null;

	constructor(
		private readonly app: App,
		private readonly store: SettingsStore,
		private readonly priorityProperties: string[] = [],
		private readonly reactive = true,
	) {}

	mount(container: HTMLElement): void {
		this.container = container;
		if (this.reactive) this.unsubscribe = this.store.subscribe(() => this.render());
		this.render();
	}

	unmount(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.popover?.close();
		this.popover = null;
		this.clearRuleDragState();
		this.container = null;
	}

	private render(): void {
		if (!this.container) return;
		this.container.empty();
		this.container.addClass('bpc-rule-manager');
		this.container.createEl('p', {
			text: 'Apply soft color to a matching cell or its entire row. Rules run from top to bottom; the first matching rule for each target wins.',
			cls: 'setting-item-description bpc-rule-manager__intro',
		});

		const toolbar = this.container.createDiv('bpc-rule-manager__toolbar');
		const search = toolbar.createEl('input', {
			type: 'search',
			placeholder: 'Search rules…',
			attr: { 'aria-label': 'Search conditional formatting rules', autocomplete: 'off', name: 'bpc-rule-search' },
		});
		search.value = this.store.settings.ruleManagerSearch;
		const add = toolbar.createEl('button', { text: 'Add rule', cls: 'mod-cta', attr: { type: 'button' } });
		add.disabled = this.properties().length === 0;
		if (add.disabled) add.title = 'Open a base table first so its properties can be discovered.';
		add.addEventListener('click', () => {
			const property = this.properties()[0] ?? '';
			const rule = this.store.addRule(property);
			queueMicrotask(() => this.container?.querySelector<HTMLElement>(`[data-rule-id="${CSS.escape(rule.id)}"] input`)?.focus());
		});

		const list = this.container.createDiv('bpc-rule-list');
		const reorderStatus = this.container.createDiv('bpc-rule-reorder-status');
		reorderStatus.setAttribute('aria-live', 'polite');
		reorderStatus.setAttribute('aria-atomic', 'true');
		const renderList = () => {
			list.empty();
			const query = search.value.trim().toLocaleLowerCase();
			const rules = this.store.settings.rules.filter((rule) =>
				!query || `${rule.name} ${rule.propertyId} ${OPERATOR_LABELS[rule.operator]}`.toLocaleLowerCase().includes(query));
			if (!this.store.settings.rules.length) {
				const empty = list.createDiv('bpc-empty-state');
				empty.createEl('strong', { text: 'No formatting rules yet' });
				empty.createEl('p', { text: 'Add a rule to highlight matching cells or rows in every visible base table.' });
				return;
			}
			if (!rules.length) {
				list.createDiv({ cls: 'bpc-empty-state', text: 'No matching rules.' });
				return;
			}
			for (const rule of rules) this.renderRule(list, rule, query.length === 0);
		};
		search.addEventListener('input', () => {
			this.store.setRuleManagerSearch(search.value);
			renderList();
		});
		renderList();
	}

	private renderRule(container: HTMLElement, rule: ConditionalRule, dragEnabled: boolean): void {
		const actualIndex = this.store.settings.rules.findIndex((candidate) => candidate.id === rule.id);
		const card = container.createEl('section', { cls: 'bpc-rule-card' });
		card.dataset.ruleId = rule.id;
		card.classList.toggle('is-disabled', !rule.enabled);
		card.addEventListener('keydown', (event) => {
			if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
			event.preventDefault();
			this.moveRuleAndAnnounce(rule, event.key === 'ArrowUp' ? -1 : 1);
		});
		this.bindRuleDropTarget(card, rule, dragEnabled);

		const header = card.createDiv('bpc-rule-card__header');
		const handle = header.createSpan('bpc-rule-card__drag-handle');
		setIcon(handle, 'grip-vertical');
		handle.draggable = dragEnabled;
		handle.setAttribute('aria-hidden', 'true');
		handle.title = dragEnabled ? `Drag ${rule.name} to reorder` : 'Clear rule search to drag and reorder';
		handle.addEventListener('dragstart', (event) => {
			if (!dragEnabled) {
				event.preventDefault();
				return;
			}
			this.draggedRuleId = rule.id;
			card.classList.add('is-dragging');
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData('text/plain', rule.id);
			}
		});
		handle.addEventListener('dragend', () => this.clearRuleDragState());
		const enabled = header.createEl('input', { type: 'checkbox', attr: { 'aria-label': `Enable ${rule.name}`, name: `bpc-rule-enabled-${rule.id}` } });
		enabled.checked = rule.enabled;
		enabled.addEventListener('change', () => this.store.updateRule(rule.id, { enabled: enabled.checked }));
		const name = header.createEl('input', {
			type: 'text',
			cls: 'bpc-rule-card__name',
			attr: { 'aria-label': 'Rule name', autocomplete: 'off', name: `bpc-rule-name-${rule.id}` },
		});
		name.value = rule.name;
		name.addEventListener('change', () => this.store.updateRule(rule.id, { name: name.value.trim() || 'Formatting rule' }));
		const actions = header.createDiv('bpc-rule-card__actions');
		this.iconButton(actions, 'arrow-up', 'Move rule up', actualIndex === 0, () => this.moveRuleAndAnnounce(rule, -1));
		this.iconButton(actions, 'arrow-down', 'Move rule down', actualIndex === this.store.settings.rules.length - 1, () => this.moveRuleAndAnnounce(rule, 1));
		this.iconButton(actions, 'copy', 'Duplicate rule', false, () => this.store.duplicateRule(rule.id));
		this.iconButton(actions, 'trash-2', 'Delete rule', false, () => {
			new ConfirmDeleteRuleModal(this.app, rule.name, () => this.store.deleteRule(rule.id)).open();
		});

		const fieldsViewport = card.createDiv('bpc-rule-card__fields-scroll');
		fieldsViewport.tabIndex = 0;
		fieldsViewport.setAttribute('role', 'region');
		fieldsViewport.setAttribute('aria-label', `${rule.name} fields`);
		const fields = fieldsViewport.createDiv('bpc-rule-card__fields');
		const property = this.field(fields, 'Property').createEl('select', { attr: { 'aria-label': 'Property' } });
		const properties = this.properties(rule.propertyId);
		for (const propertyId of properties) property.createEl('option', { text: displayPropertyName(propertyId), value: propertyId }).title = propertyId;
		property.value = rule.propertyId;
		property.addEventListener('change', () => this.store.updateRule(rule.id, { propertyId: property.value }));

		const operator = this.field(fields, 'Condition').createEl('select', { attr: { 'aria-label': 'Condition' } });
		for (const value of RULE_OPERATORS) operator.createEl('option', { text: OPERATOR_LABELS[value], value });
		operator.value = rule.operator;
		operator.addEventListener('change', () => this.store.updateRule(rule.id, { operator: operator.value as ConditionalRule['operator'] }));

		const valueField = this.field(fields, 'Value');
		const operand = valueField.createEl('input', {
			type: 'text',
			attr: { 'aria-label': 'Comparison value', autocomplete: 'off', name: `bpc-rule-value-${rule.id}` },
		});
		operand.value = rule.operand ?? '';
		operand.disabled = !operatorNeedsOperand(rule.operator);
		operand.placeholder = operand.disabled ? 'Not required' : 'Enter a value…';
		operand.addEventListener('change', () => this.store.updateRule(rule.id, { operand: operand.value }));

		const target = this.field(fields, 'Apply to').createEl('select', { attr: { 'aria-label': 'Apply formatting to' } });
		target.createEl('option', { text: 'Cell', value: 'cell' });
		target.createEl('option', { text: 'Entire row', value: 'row' });
		target.value = rule.target;
		target.addEventListener('change', () => this.store.updateRule(rule.id, { target: target.value as ConditionalRule['target'] }));

		const scope = this.field(fields, 'Available in').createEl('select', { attr: { 'aria-label': 'Rule scope' } });
		scope.createEl('option', { text: 'This view', value: 'view' });
		scope.createEl('option', { text: 'All views', value: 'base' });
		scope.value = rule.scope ?? 'base';
		scope.addEventListener('change', () => this.store.updateRule(rule.id, { scope: scope.value as ConditionalRule['scope'] }));

		const colorField = this.field(fields, 'Color');
		const color = colorField.createEl('button', { cls: 'bpc-rule-color', attr: { type: 'button', 'aria-label': 'Choose formatting color' } });
		const resolved = rule.color.kind === 'preset' ? resolvePreset(rule.color.name, this.store.getPaletteTemplateId()) : resolveRuleColor(rule.color.hex);
		color.style.setProperty('--bpc-rule-color', resolved.dot);
		color.createSpan({ cls: 'bpc-rule-color__dot' });
		color.createSpan({ text: resolved.label });
		color.addEventListener('click', () => {
			this.popover?.close();
			this.popover = new RuleColorPopover(this.store.getPaletteTemplateId(), (next) => this.store.updateRule(rule.id, { color: next }));
			this.popover.open(color, rule.color);
		});
	}

	private bindRuleDropTarget(card: HTMLElement, targetRule: ConditionalRule, enabled: boolean): void {
		card.addEventListener('dragover', (event) => {
			if (!enabled || !this.draggedRuleId || this.draggedRuleId === targetRule.id) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
			const before = event.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
			this.clearDropIndicators();
			card.classList.add(before ? 'is-drop-before' : 'is-drop-after');
		});
		card.addEventListener('dragleave', (event) => {
			if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return;
			card.classList.remove('is-drop-before', 'is-drop-after');
		});
		card.addEventListener('drop', (event) => {
			if (!enabled || !this.draggedRuleId || this.draggedRuleId === targetRule.id) return;
			event.preventDefault();
			const draggedId = this.draggedRuleId;
			const from = this.store.settings.rules.findIndex((candidate) => candidate.id === draggedId);
			const target = this.store.settings.rules.findIndex((candidate) => candidate.id === targetRule.id);
			if (from < 0 || target < 0) return this.clearRuleDragState();
			const before = card.classList.contains('is-drop-before');
			let insertion = target + (before ? 0 : 1);
			if (from < insertion) insertion -= 1;
			this.store.moveRuleTo(draggedId, insertion);
			this.announceRuleMove(draggedId);
			this.clearRuleDragState();
		});
	}

	private moveRuleAndAnnounce(rule: ConditionalRule, direction: -1 | 1): void {
		const index = this.store.settings.rules.findIndex((candidate) => candidate.id === rule.id);
		const target = index + direction;
		if (index < 0 || target < 0 || target >= this.store.settings.rules.length) return;
		this.store.moveRuleTo(rule.id, target);
		this.announceRuleMove(rule.id);
	}

	private announceRuleMove(ruleId: string): void {
		queueMicrotask(() => {
			const rule = this.store.settings.rules.find((candidate) => candidate.id === ruleId);
			const index = this.store.settings.rules.findIndex((candidate) => candidate.id === ruleId);
			const status = this.container?.querySelector<HTMLElement>('.bpc-rule-reorder-status');
			if (rule && index >= 0 && status) status.textContent = `${rule.name} moved to position ${index + 1} of ${this.store.settings.rules.length}.`;
		});
	}

	private clearDropIndicators(): void {
		this.container?.querySelectorAll('.bpc-rule-card.is-drop-before, .bpc-rule-card.is-drop-after')
			.forEach((card) => card.classList.remove('is-drop-before', 'is-drop-after'));
	}

	private clearRuleDragState(): void {
		this.draggedRuleId = null;
		this.clearDropIndicators();
		this.container?.querySelectorAll('.bpc-rule-card.is-dragging')
			.forEach((card) => card.classList.remove('is-dragging'));
	}

	private properties(current?: string): string[] {
		return [...new Set([...this.priorityProperties, ...this.store.allKnownProperties(), ...(current ? [current] : [])])];
	}

	private field(container: HTMLElement, label: string): HTMLElement {
		const field = container.createEl('label', { cls: 'bpc-rule-field' });
		field.createSpan({ text: label, cls: 'bpc-rule-field__label' });
		return field;
	}

	private iconButton(container: HTMLElement, icon: string, label: string, disabled: boolean, action: () => void): void {
		const button = container.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': label, title: label } });
		button.disabled = disabled;
		setIcon(button, icon);
		button.addEventListener('click', action);
	}
}

class RuleColorPopover {
	private panel: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;

	constructor(private readonly paletteId: import('../core/types').PaletteTemplateId, private readonly onChange: (color: RuleColor) => void) {}

	open(anchor: HTMLElement, current: RuleColor): void {
		this.close();
		const doc = anchor.ownerDocument;
		const panel = doc.body.createDiv('bpc-popover bpc-rule-color-popover');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', 'Formatting color');
		const grid = panel.createDiv('bpc-swatch-grid');
		for (const [index] of paletteTemplate(this.paletteId).colors.entries()) {
			const name = palettePresetName(this.paletteId, index);
			const resolved = resolvePreset(name, this.paletteId);
			const swatch = grid.createEl('button', { cls: 'clickable-icon bpc-swatch', attr: { type: 'button', 'aria-label': resolved.label, title: resolved.label } });
			swatch.style.setProperty('--bpc-swatch', resolved.dot);
			swatch.setAttribute('aria-pressed', String(current.kind === 'preset' && current.name === name));
			swatch.addEventListener('click', () => { this.onChange({ kind: 'preset', name }); this.close(); });
		}
		const custom = panel.createDiv('bpc-custom-color');
		custom.createEl('label', { text: 'Custom', cls: 'bpc-custom-color__label' });
		const inputs = custom.createDiv('bpc-custom-color__inputs');
		const initial = current.kind === 'custom' ? current.hex : '#3498DB';
		const picker = inputs.createEl('input', { cls: 'bpc-custom-color__picker', attr: { type: 'color', 'aria-label': 'Custom color' } });
		picker.value = initial;
		const text = inputs.createEl('input', {
			cls: 'bpc-custom-color__text',
			attr: { type: 'text', 'aria-label': 'Custom hex color', autocomplete: 'off', name: 'bpc-rule-custom-color' },
		});
		text.value = initial;
		text.spellcheck = false;
		const error = custom.createDiv('bpc-custom-color__error');
		error.setAttribute('aria-live', 'polite');
		const apply = (value: string) => {
			const hex = normalizeHex(value);
			if (!hex) {
				text.setAttribute('aria-invalid', 'true');
				error.textContent = 'Use a 3 or 6 digit hex color.';
				return;
			}
			text.removeAttribute('aria-invalid');
			error.textContent = '';
			text.value = hex;
			picker.value = hex;
			this.onChange({ kind: 'custom', hex });
		};
		picker.addEventListener('input', () => apply(picker.value));
		text.addEventListener('change', () => apply(text.value));
		const rect = anchor.getBoundingClientRect();
		panel.style.left = `${Math.max(12, rect.left)}px`;
		panel.style.top = `${Math.max(12, rect.bottom + 6)}px`;
		const outside = (event: PointerEvent) => { if (!panel.contains(event.target as Node) && event.target !== anchor) this.close(); };
		const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') this.close(); };
		doc.addEventListener('pointerdown', outside, true);
		panel.addEventListener('keydown', keyboard);
		this.panel = panel;
		this.cleanup = () => { doc.removeEventListener('pointerdown', outside, true); panel.removeEventListener('keydown', keyboard); panel.remove(); };
	}

	close(): void {
		this.cleanup?.();
		this.cleanup = null;
		this.panel = null;
	}
}

class ConfirmDeleteRuleModal extends Modal {
	constructor(app: App, private readonly ruleName: string, private readonly onConfirm: () => void) { super(app); }
	onOpen(): void {
		this.setTitle('Delete formatting rule?');
		this.contentEl.createEl('p', { text: `“${this.ruleName}” will be permanently removed. Your notes and Base files will not be changed.` });
		const actions = this.contentEl.createDiv('bpc-confirm-modal__actions');
		const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.close());
		const remove = actions.createEl('button', { text: 'Delete rule', cls: 'mod-warning', attr: { type: 'button' } });
		remove.addEventListener('click', () => { this.onConfirm(); this.close(); });
		remove.focus();
	}
	onClose(): void { this.contentEl.empty(); }
}

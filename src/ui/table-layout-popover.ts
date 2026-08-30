import { setIcon, type App } from 'obsidian';
import {
	applyNativeColumnWidthPreset,
	COLUMN_WIDTH_PRESETS,
	getNativeColumnWidthState,
	getNativeColumnHeaders,
	getNativeColumnWidths,
	getNativeRowHeight,
	getNativeUnsetColumnProperties,
	resetNativeColumnWidths,
	ROW_HEIGHTS,
	setNativeRowHeight,
	type ColumnWidthScope,
} from '../core/native-table-view';
import { SettingsStore } from '../core/settings-store';
import type { LayoutPreset } from '../core/types';
import { ApplyAllColumnsConfirmationModal } from './apply-all-columns-confirmation';
import { ResetColumnWidthsConfirmationModal } from './reset-column-widths-confirmation';
import { bindRadioGroup, selectRadio } from './radio-group';

export class TableLayoutPopover {
	private panel: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;
	private anchor: HTMLElement | null = null;

	constructor(private readonly app: App, private readonly store: SettingsStore) {}

	toggle(anchor: HTMLElement, scope: HTMLElement): void {
		if (this.panel && this.anchor === anchor) {
			this.close();
			return;
		}
		this.open(anchor, scope);
	}

	open(anchor: HTMLElement, scope: HTMLElement): void {
		this.close();
		this.anchor = anchor;
		const doc = anchor.ownerDocument;
		const panel = doc.body.createDiv('bpc-layout-popover');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', 'Table layout');
		this.panel = panel;
		anchor.closest('.bases-toolbar-item')?.classList.add('is-active');

		const header = panel.createDiv('bpc-layout-popover__header');
		header.createEl('strong', { text: 'Table layout' });
		header.createSpan({ text: 'Current view' });

		const rowSection = panel.createDiv('bpc-layout-section');
		rowSection.createDiv({ cls: 'bpc-layout-section__label', text: 'Row height' });
		const rowGroup = rowSection.createDiv('bpc-row-height-options');
		rowGroup.setAttribute('role', 'radiogroup');
		rowGroup.setAttribute('aria-label', 'Row height');
		let currentRowHeight = getNativeRowHeight(this.app, scope);
		const rowButtons = ROW_HEIGHTS.map((option, index) => {
			const button = rowGroup.createEl('button', {
				attr: { type: 'button', role: 'radio', title: option.label },
			});
			button.setAttribute('aria-label', option.label);
			button.setAttribute('aria-checked', String(option.value === currentRowHeight));
			const preview = button.createSpan('bpc-row-height-option__preview');
			for (let line = 0; line <= index; line += 1) preview.createSpan();
			button.createSpan({ cls: 'bpc-row-height-option__label', text: option.label });
			button.addEventListener('click', () => {
				currentRowHeight = option.value;
				setNativeRowHeight(this.app, scope, option.value);
				selectRadio(rowButtons, button);
			});
			return button;
		});
		bindRadioGroup(rowGroup, rowButtons);

		const widthSection = panel.createDiv('bpc-layout-section bpc-layout-section--width');
		const widthHeading = widthSection.createDiv('bpc-layout-section__heading');
		widthHeading.createSpan({ cls: 'bpc-layout-section__label', text: 'Column width' });
		const state = getNativeColumnWidthState(this.app, scope);
		const widthMeta = widthHeading.createSpan({
			cls: 'bpc-layout-section__meta',
			text: `${state.custom} of ${state.total} set`,
		});
		let selectedWidth = this.store.settings.lastColumnWidthPreset;
		const refreshIndicators = () => renderColumnWidthIndicators(
			scope,
			getNativeColumnHeaders(this.app, scope),
			getNativeColumnWidths(this.app, scope),
			selectedWidth,
		);
		refreshIndicators();
		const Observer = scope.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
		const indicatorObserver = new Observer(() => refreshIndicators());
		indicatorObserver.observe(scope, { childList: true, subtree: true });
		let eligibleProperties = new Set(
			getNativeUnsetColumnProperties(this.app, scope, selectedWidth),
		);

		let applyTo: ColumnWidthScope = 'unset';
		const scopeGroup = widthSection.createDiv('bpc-width-scope');
		scopeGroup.setAttribute('role', 'radiogroup');
		scopeGroup.setAttribute('aria-label', 'Apply column width to');
		const scopeButtons = ([
			['unset', 'Unset only'],
			['all', 'All columns'],
		] as const).map(([value, label]) => {
			const button = scopeGroup.createEl('button', {
				text: label,
				attr: { type: 'button', role: 'radio' },
			});
			button.setAttribute('aria-checked', String(value === applyTo));
			button.addEventListener('click', () => {
				applyTo = value;
				selectRadio(scopeButtons, button);
				if (scopeNote) scopeNote.hidden = applyTo !== 'unset';
			});
			return button;
		});
		bindRadioGroup(scopeGroup, scopeButtons);
		const scopeNote = widthSection.createDiv({
			cls: 'bpc-width-scope-note',
			text: 'The indicators beside column titles show which columns will change.',
		});

		const presets = widthSection.createDiv('bpc-width-presets');
		const presetButtons: HTMLButtonElement[] = [];
		for (const preset of COLUMN_WIDTH_PRESETS) {
			const row = presets.createDiv('bpc-width-preset-row');
			const button = row.createEl('button', {
				cls: 'bpc-width-preset',
				attr: { type: 'button' },
			});
			button.setAttribute('aria-pressed', String(preset.width === selectedWidth));
			presetButtons.push(button);
			button.style.setProperty('--bpc-width-preview', `${Math.round(preset.width * 0.42)}px`);
			const preview = button.createSpan('bpc-width-preset__preview');
			preview.createSpan();
			const copy = button.createSpan('bpc-width-preset__copy');
			copy.createEl('strong', { text: preset.label });
			copy.createSpan({ text: `${preset.width} px` });
			const icon = button.createSpan('bpc-width-preset__arrow');
			setIcon(icon, 'arrow-right');
			button.addEventListener('click', () => {
				const applyPreset = () => {
					applyNativeColumnWidthPreset(this.app, scope, preset.width, applyTo, eligibleProperties);
					selectedWidth = preset.width;
					this.store.setLastColumnWidthPreset(preset.width);
					selectPressed(presetButtons, button);
					if (applyTo === 'all') {
						eligibleProperties = new Set(
							getNativeUnsetColumnProperties(this.app, scope, selectedWidth),
						);
					}
					updateWidthMeta(widthMeta, this.app, scope);
					refreshIndicators();
				};
				if (applyTo === 'all') {
					new ApplyAllColumnsConfirmationModal(this.app, {
						width: preset.width,
						onConfirm: applyPreset,
					}).open();
				} else applyPreset();
			});
		}

		const savedSection = panel.createDiv('bpc-layout-section bpc-layout-section--saved');
		const savedHeading = savedSection.createDiv('bpc-layout-section__heading');
		savedHeading.createSpan({ cls: 'bpc-layout-section__label', text: 'Saved layouts' });
		const savedList = savedSection.createDiv('bpc-layout-presets');
		const renderLayoutPreset = (preset: LayoutPreset): void => {
			const row = savedList.createDiv('bpc-layout-preset');
			const apply = row.createEl('button', {
				cls: 'clickable-icon bpc-layout-preset__apply',
				attr: { type: 'button' },
			});
			const copy = apply.createSpan('bpc-layout-preset__copy');
			copy.createEl('strong', { text: preset.name });
			copy.createSpan({ text: describeLayoutPreset(preset) });
			const arrow = apply.createSpan('bpc-layout-preset__arrow');
			setIcon(arrow, 'arrow-right');
			apply.addEventListener('click', () => {
				const applyLayout = () => {
					setNativeRowHeight(this.app, scope, preset.rowHeight);
					currentRowHeight = preset.rowHeight;
					const rowIndex = ROW_HEIGHTS.findIndex((option) => option.value === preset.rowHeight);
					if (rowIndex >= 0 && rowButtons[rowIndex]) selectRadio(rowButtons, rowButtons[rowIndex]);

					applyTo = preset.columnScope;
					selectRadio(scopeButtons, scopeButtons[applyTo === 'all' ? 1 : 0]);
					scopeNote.hidden = applyTo !== 'unset';
					applyNativeColumnWidthPreset(
						this.app,
						scope,
						preset.columnWidth,
						applyTo,
						eligibleProperties,
					);
					selectedWidth = preset.columnWidth;
					this.store.setLastColumnWidthPreset(preset.columnWidth);
					const widthIndex = COLUMN_WIDTH_PRESETS.findIndex((option) =>
						option.width === preset.columnWidth);
					selectPressed(presetButtons, widthIndex >= 0 ? presetButtons[widthIndex] ?? null : null);
					if (applyTo === 'all') {
						eligibleProperties = new Set(
							getNativeUnsetColumnProperties(this.app, scope, selectedWidth),
						);
					}
					updateWidthMeta(widthMeta, this.app, scope);
					refreshIndicators();
				};
				if (preset.columnScope === 'all') {
					new ApplyAllColumnsConfirmationModal(this.app, {
						width: preset.columnWidth,
						layoutName: preset.name,
						rowHeightLabel: rowHeightLabel(preset.rowHeight),
						onConfirm: applyLayout,
					}).open();
				} else applyLayout();
			});
			const remove = row.createEl('button', {
				cls: 'clickable-icon bpc-layout-preset__remove',
				attr: { type: 'button', 'aria-label': `Delete ${preset.name}`, title: `Delete ${preset.name}` },
			});
			setIcon(remove, 'x');
			remove.addEventListener('click', () => {
				this.store.deleteLayoutPreset(preset.id);
				row.remove();
				updateEmptyState();
			});
		};
		const empty = savedList.createDiv('bpc-layout-presets__empty');
		const updateEmptyState = () => {
			empty.hidden = savedList.querySelector('.bpc-layout-preset') !== null;
			empty.textContent = empty.hidden ? '' : 'No saved layouts yet.';
		};
		for (const preset of this.store.settings.layoutPresets) renderLayoutPreset(preset);
		updateEmptyState();

		const creator = savedSection.createDiv('bpc-layout-creator');
		const revealCreator = creator.createEl('button', {
			cls: 'clickable-icon bpc-layout-creator__reveal',
			attr: { type: 'button' },
		});
		const addIcon = revealCreator.createSpan();
		setIcon(addIcon, 'plus');
		revealCreator.createSpan({ text: 'Save current layout' });
		const form = creator.createEl('form', { cls: 'bpc-layout-creator__form' });
		form.hidden = true;
		const nameInput = form.createEl('input', {
			type: 'text',
			placeholder: 'Layout name',
			attr: { 'aria-label': 'Layout name', maxlength: '40', autocomplete: 'off' },
		});
		form.createEl('button', { text: 'Save', cls: 'mod-cta', attr: { type: 'submit' } });
		const summary = form.createDiv('bpc-layout-creator__summary');
		const error = form.createDiv('bpc-layout-creator__error');
		error.setAttribute('aria-live', 'polite');
		revealCreator.addEventListener('click', () => {
			revealCreator.hidden = true;
			form.hidden = false;
			summary.textContent = selectedWidth === null
				? 'Choose a column width before saving.'
				: describeLayout(currentRowHeight, selectedWidth, applyTo);
			nameInput.focus();
		});
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			if (selectedWidth === null) {
				error.textContent = 'Choose a column width before saving.';
				return;
			}
			const preset = this.store.addLayoutPreset(
				nameInput.value,
				currentRowHeight,
				selectedWidth,
				applyTo,
			);
			if (!preset) {
				error.textContent = 'Enter a layout name.';
				return;
			}
			error.textContent = '';
			renderLayoutPreset(preset);
			updateEmptyState();
			nameInput.value = '';
			form.hidden = true;
			revealCreator.hidden = false;
			revealCreator.focus();
		});

		const footer = panel.createDiv('bpc-layout-popover__footer');
		const reset = footer.createEl('button', {
			cls: 'clickable-icon bpc-layout-reset',
			attr: { type: 'button' },
		});
		const resetIcon = reset.createSpan();
		setIcon(resetIcon, 'rotate-ccw');
		reset.createSpan({ text: 'Reset column widths' });
		reset.addEventListener('click', () => {
			this.close();
			new ResetColumnWidthsConfirmationModal(
				this.app,
				() => resetNativeColumnWidths(this.app, scope),
			).open();
		});

		const dismiss = (event: PointerEvent) => {
			if ((event.target as Element | null)?.closest?.('.modal-container')) return;
			if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) this.close();
		};
		const keydown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			this.close();
			anchor.focus();
		};
		doc.addEventListener('pointerdown', dismiss, true);
		panel.addEventListener('keydown', keydown);
		this.cleanup = () => {
			indicatorObserver.disconnect();
			doc.removeEventListener('pointerdown', dismiss, true);
			panel.removeEventListener('keydown', keydown);
			anchor.closest('.bases-toolbar-item')?.classList.remove('is-active');
			clearColumnWidthIndicators(scope);
			panel.remove();
		};
		positionPopover(panel, anchor);
		queueMicrotask(() => rowButtons.find((button) =>
			button.getAttribute('aria-checked') === 'true')?.focus());
	}

	close(): void {
		this.cleanup?.();
		this.cleanup = null;
		this.panel = null;
		this.anchor = null;
	}
}

function renderColumnWidthIndicators(
	scope: HTMLElement,
	headers: Array<{ propertyId: string; element: HTMLElement }>,
	widths: Record<string, number>,
	selectedWidth: number | null,
): void {
	if (selectedWidth === null) {
		clearColumnWidthIndicators(scope);
		return;
	}
	for (const { propertyId, element: header } of headers) {
		const width = widths[propertyId] ?? 0;
		const matches = width === selectedWidth;
		const host = header.querySelector<HTMLElement>(
			'.bases-table-header-label, .bases-table-header-name',
		) ?? header;
		let indicator = host.querySelector<HTMLElement>(':scope > .bpc-column-width-indicator');
		const state = `${selectedWidth}:${width}:${matches}`;
		if (!indicator) indicator = host.createSpan('bpc-column-width-indicator');
		if (indicator.dataset.state === state) continue;
		indicator.dataset.state = state;
		indicator.classList.toggle('is-matching', matches);
		indicator.empty();
		setIcon(indicator, matches ? 'circle-check' : 'circle');
		const current = width > 0 ? `${width} px` : 'automatic';
		const label = matches
			? `Column matches selected width: ${selectedWidth} px`
			: `Column width is ${current}; selected width is ${selectedWidth} px`;
		indicator.setAttribute('aria-label', label);
		indicator.title = label;
	}
}

function clearColumnWidthIndicators(scope: HTMLElement): void {
	scope.querySelectorAll('.bpc-column-width-indicator').forEach((indicator) => indicator.remove());
}

function selectPressed(buttons: HTMLButtonElement[], selected: HTMLButtonElement | null): void {
	for (const button of buttons) button.setAttribute('aria-pressed', String(button === selected));
}

function updateWidthMeta(element: HTMLElement, app: App, scope: HTMLElement): void {
	const state = getNativeColumnWidthState(app, scope);
	element.textContent = `${state.custom} of ${state.total} set`;
}

function describeLayoutPreset(preset: LayoutPreset): string {
	return describeLayout(preset.rowHeight, preset.columnWidth, preset.columnScope);
}

function describeLayout(rowHeight: LayoutPreset['rowHeight'], width: number, scope: ColumnWidthScope): string {
	const rowLabel = rowHeightLabel(rowHeight);
	return `${rowLabel} rows · ${width} px · ${scope === 'all' ? 'All columns' : 'Unset only'}`;
}

function rowHeightLabel(rowHeight: LayoutPreset['rowHeight']): string {
	return ROW_HEIGHTS.find((option) => option.value === rowHeight)?.label ?? 'Short';
}

function positionPopover(panel: HTMLElement, anchor: HTMLElement): void {
	const win = anchor.ownerDocument.defaultView;
	if (!win) return;
	const anchorRect = anchor.getBoundingClientRect();
	const panelRect = panel.getBoundingClientRect();
	const margin = 12;
	panel.style.left = `${Math.max(margin, Math.min(anchorRect.left, win.innerWidth - panelRect.width - margin))}px`;
	panel.style.top = `${Math.max(margin, Math.min(anchorRect.bottom + 6, win.innerHeight - panelRect.height - margin))}px`;
}

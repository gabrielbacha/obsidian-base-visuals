import { setIcon, type App } from 'obsidian';
import { resolveColor } from '../core/colors';
import type { ColumnMenuRequest } from '../core/pill-enhancer';
import { SettingsStore } from '../core/settings-store';
import { OptionIdentity } from '../core/types';
import { ColorControlsHandle, renderColorControls } from './color-controls';
import { displayPropertyName } from './color-popover';
import { applyPreviewColor, ConfirmResetModal } from './pill-color-manager';
import { renderPropertyStrategyControls } from './property-strategy-controls';

type BackAction = (() => void) | null;

export class ColumnPillPopover {
	private panel: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;
	private controls: ColorControlsHandle | null = null;
	private backAction: BackAction = null;

	constructor(
		private readonly app: App,
		private readonly store: SettingsStore,
	) {}

	open(request: ColumnMenuRequest): void {
		this.close();
		const selectedIdentity = { propertyId: request.propertyId, value: request.value };
		const store = request.store ?? this.store;
		const propertyName = request.propertyName ?? displayPropertyName(request.propertyId);
		for (const value of request.values) store.ensure({ propertyId: request.propertyId, value });

		const panel = request.document.body.createDiv('bpc-column-popover');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', `Actions for ${request.value}`);
		panel.tabIndex = -1;
		this.panel = panel;

		const prepareView = (mode: 'quick' | 'palette' | 'column' | 'confirm', backAction: BackAction) => {
			this.controls?.destroy();
			this.controls = null;
			this.backAction = backAction;
			panel.empty();
			panel.classList.toggle('is-column-view', mode === 'column');
			panel.classList.toggle('is-palette-view', mode === 'palette');
		};

		const renderQuick = () => {
			prepareView('quick', null);
			const header = panel.createDiv('bpc-context-header');
			createPreview(header, selectedIdentity, store, propertyName);
			header.createSpan({ text: propertyName, cls: 'bpc-context-header__property' });

			const menu = panel.createDiv('bpc-context-menu');
			const resolved = resolveColor(selectedIdentity, store.get(selectedIdentity)?.override, store.getPropertyStrategy(request.propertyId, propertyName), store.getPaletteTemplateId());
			const color = createMenuItem(menu, 'Change color', resolved.label, 'chevron');
			color.prepend(createColorDot(color, resolved.dot));
			color.addEventListener('click', () => renderPalette(selectedIdentity, renderQuick));

			if (store.get(selectedIdentity)?.override) {
				const reset = createMenuItem(menu, 'Use property strategy', undefined, 'reset');
				reset.addEventListener('click', () => {
					store.setOverride(selectedIdentity);
					this.close();
				});
			}

			const manage = createMenuItem(
				menu,
				`Manage “${propertyName}” colors`,
				`${request.values.length}`,
				'chevron',
			);
			manage.prepend(createIcon(manage, 'palette'));
			manage.addEventListener('click', renderColumn);

			menu.createDiv('bpc-context-menu__separator');
			const remove = createMenuItem(menu, 'Remove from row', undefined, 'remove');
			remove.addClass('is-destructive');
			remove.disabled = !request.removal.available;
			if (remove.disabled) {
				remove.title = 'Unavailable because the installed Obsidian version does not expose a compatible pill removal control.';
				remove.setAttribute('aria-description', remove.title);
			} else remove.addEventListener('click', renderRemoveConfirmation);
			finishView(panel, request.point, color);
		};

		const renderRemoveConfirmation = () => {
			prepareView('confirm', renderQuick);
			const header = createNavigationHeader(panel, renderQuick);
			header.createEl('strong', { text: 'Remove value?' });
			const body = panel.createDiv('bpc-remove-confirm');
			createPreview(body, selectedIdentity, store, propertyName);
			body.createEl('p', { text: 'Remove this value from the current row?' });
			const actions = body.createDiv('bpc-remove-confirm__actions');
			const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
			cancel.addEventListener('click', renderQuick);
			const confirm = actions.createEl('button', { text: 'Remove', cls: 'mod-warning', attr: { type: 'button' } });
			confirm.addEventListener('click', () => {
				request.removal.remove();
				this.close();
			});
			finishView(panel, request.point, cancel);
		};

		const renderPalette = (identity: OptionIdentity, goBack: () => void) => {
			prepareView('palette', goBack);
			const header = createNavigationHeader(panel, goBack);
			createPreview(header, identity, store, propertyName);
			header.createSpan({ text: propertyName, cls: 'bpc-context-header__property' });
			const body = panel.createDiv('bpc-context-palette');
			this.controls = renderColorControls(body, store, identity);
			finishView(panel, request.point);
			this.controls.focus();
		};

		const renderColumn = () => {
			prepareView('column', renderQuick);
			const header = createNavigationHeader(panel, renderQuick);
			const heading = header.createDiv('bpc-column-manager__heading');
			heading.createEl('strong', { text: propertyName });
			heading.createSpan({ text: `${request.values.length} values` });
			const reset = header.createEl('button', {
				text: 'Reset',
				cls: 'clickable-icon bpc-column-manager__reset',
				attr: { type: 'button', 'aria-label': `Reset ${propertyName} colors` },
			});
			reset.addEventListener('click', () => {
				new ConfirmResetModal(
					this.app,
					`Reset ${propertyName} colors?`,
					'Value overrides will be cleared and this property will return to its Smart strategy.',
					() => {
						store.resetProperty(request.propertyId);
						renderColumn();
					},
				).open();
			});

			const body = panel.createDiv('bpc-column-manager');
			renderPropertyStrategyControls(body, store, request.propertyId, propertyName, renderColumn);
			let search: HTMLInputElement | null = null;
			if (request.values.length >= 7) {
				search = body.createEl('input', {
					type: 'search',
					placeholder: 'Search values…',
					cls: 'bpc-column-manager__search',
					attr: { 'aria-label': 'Search column values', autocomplete: 'off', name: 'bpc-column-value-search' },
				});
			}
			const list = body.createDiv('bpc-column-manager__list');
			const renderValues = () => {
				list.empty();
				const query = search?.value.trim().toLocaleLowerCase() ?? '';
				const values = request.values.filter((value) => !query || value.toLocaleLowerCase().includes(query));
				if (values.length === 0) {
					list.createDiv({ text: 'No matching values.', cls: 'bpc-column-manager__empty' });
					return;
				}
				for (const value of values) {
					const identity = { propertyId: request.propertyId, value };
					const resolved = resolveColor(identity, store.get(identity)?.override, store.getPropertyStrategy(request.propertyId, propertyName), store.getPaletteTemplateId());
					const row = list.createEl('button', {
						cls: 'clickable-icon bpc-column-manager__row',
						attr: { type: 'button', 'data-bpc-menuitem': 'true' },
					});
					row.classList.toggle('is-selected', value === request.value);
					createPreview(row, identity, store, propertyName);
					const state = row.createSpan('bpc-column-manager__state');
					state.append(createColorDot(state, resolved.dot));
					state.createSpan({ text: resolved.label });
					row.append(createIcon(row, 'chevron-right', 'bpc-context-menu__chevron'));
					row.addEventListener('click', () => renderPalette(identity, renderColumn));
				}
			};
			search?.addEventListener('input', renderValues);
			renderValues();
			const preferred = list.querySelector<HTMLElement>('.is-selected') ?? list.querySelector<HTMLElement>('[data-bpc-menuitem]');
			finishView(panel, request.point, search ?? preferred);
		};

		const outsideHandler = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (target && (target as Element).closest?.('.bpc-custom-dropdown__menu')) return;
			const modal = request.document.querySelector('.modal-container');
			if (!panel.contains(event.target as Node) && !modal?.contains(event.target as Node)) this.close();
		};
		const keyHandler = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.close();
				return;
			}
			const target = event.target as HTMLElement;
			const editing = target.matches('input, textarea, [contenteditable="true"]');
			if (!editing && this.backAction && (event.key === 'ArrowLeft' || event.key === 'Backspace')) {
				event.preventDefault();
				this.backAction();
				return;
			}
			if (editing || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
			const items = [...panel.querySelectorAll<HTMLElement>('[data-bpc-menuitem]:not([disabled])')];
			if (items.length === 0) return;
			const current = items.indexOf(target.closest<HTMLElement>('[data-bpc-menuitem]') ?? target);
			const offset = event.key === 'ArrowDown' ? 1 : -1;
			event.preventDefault();
			items[(current + offset + items.length) % items.length]?.focus();
		};
		request.document.addEventListener('pointerdown', outsideHandler, true);
		panel.addEventListener('keydown', keyHandler);
		this.cleanup = () => {
			request.document.removeEventListener('pointerdown', outsideHandler, true);
			panel.removeEventListener('keydown', keyHandler);
			panel.remove();
		};
		renderQuick();
	}

	close(): void {
		this.cleanup?.();
		this.cleanup = null;
		this.controls?.destroy();
		this.controls = null;
		this.backAction = null;
		this.panel = null;
	}
}

function createMenuItem(
	container: HTMLElement,
	label: string,
	meta?: string,
	icon?: 'chevron' | 'reset' | 'remove',
): HTMLButtonElement {
	const button = container.createEl('button', {
		cls: 'clickable-icon bpc-context-menu__item',
		attr: { type: 'button', 'data-bpc-menuitem': 'true' },
	});
	if (icon === 'reset') button.append(createIcon(button, 'rotate-ccw'));
	if (icon === 'remove') button.append(createIcon(button, 'trash-2'));
	button.createSpan({ text: label, cls: 'bpc-context-menu__label' });
	if (meta) button.createSpan({ text: meta, cls: 'bpc-context-menu__meta' });
	if (icon === 'chevron') button.append(createIcon(button, 'chevron-right', 'bpc-context-menu__chevron'));
	return button;
}

function createNavigationHeader(container: HTMLElement, back: () => void): HTMLElement {
	const header = container.createDiv('bpc-context-header bpc-context-header--navigation');
	const button = header.createEl('button', {
		cls: 'clickable-icon bpc-context-header__back',
		attr: { type: 'button', 'aria-label': 'Back' },
	});
	setIcon(button, 'arrow-left');
	button.addEventListener('click', back);
	return header;
}

function createPreview(container: HTMLElement, identity: OptionIdentity, store: SettingsStore, propertyName?: string): HTMLElement {
	const preview = container.createSpan({
		text: identity.value,
		cls: 'bpc-pill bpc-pill--colored bpc-settings-pill',
	});
	preview.title = identity.value;
	applyPreviewColor(preview, store.ensure(identity), store, propertyName);
	return preview;
}

function createColorDot(container: HTMLElement, color: string): HTMLElement {
	const dot = container.createSpan({ cls: 'bpc-context-menu__dot' });
	dot.style.setProperty('--bpc-menu-color', color);
	return dot;
}

function createIcon(container: HTMLElement, icon: string, className = 'bpc-context-menu__glyph'): HTMLElement {
	const element = container.createSpan({ cls: className, attr: { 'aria-hidden': 'true' } });
	setIcon(element, icon);
	return element;
}

function finishView(panel: HTMLElement, point: { x: number; y: number }, focus?: HTMLElement | null): void {
	positionPanel(panel, point);
	queueMicrotask(() => focus?.focus());
}

function positionPanel(panel: HTMLElement, point: { x: number; y: number }): void {
	const win = panel.ownerDocument.defaultView;
	if (!win) return;
	const margin = 12;
	const rect = panel.getBoundingClientRect();
	panel.style.left = `${Math.max(margin, Math.min(point.x, win.innerWidth - rect.width - margin))}px`;
	panel.style.top = `${Math.max(margin, Math.min(point.y, win.innerHeight - rect.height - margin))}px`;
}

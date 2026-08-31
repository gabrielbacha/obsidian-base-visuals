import { setIcon } from 'obsidian';
import type { SettingsStore } from '../core/settings-store';
import { renderPropertyStrategyControls } from './property-strategy-controls';

export class ColumnPillAppearancePopover {
	private panel: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;

	open(
		anchor: HTMLElement,
		store: SettingsStore,
		propertyId: string,
		displayName: string,
		onChange: () => void,
	): void {
		this.close();
		const doc = anchor.ownerDocument;
		const anchorRect = snapshotRect(anchor.getBoundingClientRect());
		const panel = doc.body.createDiv('bpc-column-pill-appearance-popover');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', `Pill appearance for ${displayName}`);
		this.panel = panel;

		const render = () => {
			panel.empty();
			const header = panel.createDiv('bpc-column-pill-appearance__header');
			const title = header.createDiv();
			title.createEl('strong', { text: 'Pill appearance' });
			title.createSpan({ text: displayName });
			const close = header.createEl('button', {
				cls: 'clickable-icon',
				attr: { type: 'button', 'aria-label': 'Close pill appearance' },
			});
			setIcon(close, 'x');
			close.addEventListener('click', () => this.close());

			const controls = panel.createDiv('bpc-column-pill-appearance__controls');
			renderPropertyStrategyControls(controls, store, propertyId, displayName, () => {
				onChange();
			});

			const footer = panel.createDiv('bpc-column-appearance__footer');
			const reset = footer.createEl('button', {
				cls: 'clickable-icon',
				attr: { type: 'button', 'aria-label': 'Reset pill appearance' },
			});
			const resetIcon = reset.createSpan();
			setIcon(resetIcon, 'rotate-ccw');
			reset.createSpan({ text: 'Reset appearance' });
			reset.addEventListener('click', () => {
				store.resetProperty(propertyId);
				onChange();
				void store.flush();
				this.close();
			});
		};
		render();

		const dismiss = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (
				target &&
				!panel.contains(target) &&
				!anchor.contains(target) &&
				!(target as Element).closest?.('.bpc-custom-dropdown__menu')
			) {
				this.close();
			}
		};
		const changeNativeMenuItem = (event: PointerEvent) => {
			const target = event.target as Element | null;
			if (target?.closest?.('.bpc-custom-dropdown__menu')) return;
			const item = target?.closest?.('.menu-item');
			if (item && item !== anchor && !panel.contains(item)) this.close();
		};
		const keydown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			this.close();
			anchor.focus();
		};
		doc.addEventListener('pointerdown', dismiss, true);
		doc.addEventListener('pointerover', changeNativeMenuItem, true);
		panel.addEventListener('keydown', keydown);
		this.cleanup = () => {
			for (const openMenu of doc.querySelectorAll<HTMLElement>('.bpc-custom-dropdown__menu')) {
				openMenu.remove();
			}
			doc.removeEventListener('pointerdown', dismiss, true);
			doc.removeEventListener('pointerover', changeNativeMenuItem, true);
			panel.removeEventListener('keydown', keydown);
			anchor.classList.remove('selected');
			panel.remove();
		};
		positionPopover(panel, doc, anchorRect);
		queueMicrotask(() => panel.querySelector<HTMLButtonElement>('.bpc-custom-dropdown__trigger')?.focus());
	}

	close(): void {
		this.cleanup?.();
		this.cleanup = null;
		this.panel = null;
	}
}

interface AnchorRect {
	left: number;
	right: number;
	top: number;
}

function snapshotRect(rect: DOMRect): AnchorRect {
	return { left: rect.left, right: rect.right, top: rect.top };
}

function positionPopover(panel: HTMLElement, doc: Document, rect: AnchorRect): void {
	const win = doc.defaultView;
	const viewportWidth = win?.innerWidth ?? document.documentElement.clientWidth;
	const viewportHeight = win?.innerHeight ?? document.documentElement.clientHeight;
	const width = Math.min(340, viewportWidth - 24);
	panel.style.width = `${width}px`;
	const panelHeight = Math.min(panel.offsetHeight || 280, viewportHeight - 24);
	const right = Math.max(12, rect.right + 6);
	const left = right + width <= viewportWidth - 12
		? right
		: Math.max(12, rect.left - width - 6);
	panel.style.left = `${left}px`;
	panel.style.top = `${Math.max(12, Math.min(rect.top, viewportHeight - panelHeight - 12))}px`;
}

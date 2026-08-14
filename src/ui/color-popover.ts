import { SettingsStore } from '../core/settings-store';
import { OptionIdentity } from '../core/types';
import { ColorControlsHandle, renderColorControls } from './color-controls';

export class ColorPopover {
	private panel: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;
	private controls: ColorControlsHandle | null = null;

	constructor(private readonly store: SettingsStore) {}

	openAtPoint(
		doc: Document,
		point: { x: number; y: number },
		identity: OptionIdentity,
		store: SettingsStore = this.store,
	): void {
		this.open(doc, point, identity, store);
	}

	openAtElement(anchor: HTMLElement, identity: OptionIdentity, store: SettingsStore = this.store): void {
		const rect = anchor.getBoundingClientRect();
		this.open(
			anchor.ownerDocument,
			{ x: rect.left, y: rect.bottom + 6 },
			identity,
			store,
		);
	}

	close(): void {
		this.cleanup?.();
		this.controls?.destroy();
		this.controls = null;
		this.cleanup = null;
		this.panel = null;
	}

	private open(
		doc: Document,
		point: { x: number; y: number },
		identity: OptionIdentity,
		store: SettingsStore,
	): void {
		this.close();
		const panel = doc.body.createDiv('bpc-popover');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', `Color for ${identity.value}`);
		panel.tabIndex = -1;

		const header = panel.createDiv('bpc-popover__header');
		const title = header.createEl('strong', { cls: 'bpc-popover__title' });
		title.textContent = identity.value;
		title.title = identity.value;
		const property = header.createSpan('bpc-popover__property');
		property.textContent = displayPropertyName(identity.propertyId);

		this.controls = renderColorControls(panel, store, identity, () => this.close());

		this.panel = panel;
		positionPanel(panel, point);

		const outsideHandler = (event: PointerEvent) => {
			if (!panel.contains(event.target as Node)) this.close();
		};
		const keyHandler = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.close();
				return;
			}
		};

		doc.addEventListener('pointerdown', outsideHandler, true);
		panel.addEventListener('keydown', keyHandler);
		this.cleanup = () => {
			doc.removeEventListener('pointerdown', outsideHandler, true);
			panel.removeEventListener('keydown', keyHandler);
			panel.remove();
		};

		this.controls.focus();
	}
}

export function displayPropertyName(propertyId: string): string {
	const separator = propertyId.indexOf('.');
	return separator >= 0 ? propertyId.slice(separator + 1) : propertyId;
}

function positionPanel(
	panel: HTMLElement,
	point: { x: number; y: number },
): void {
	const win = panel.ownerDocument.defaultView;
	if (!win) return;
	const margin = 12;
	const rect = panel.getBoundingClientRect();
	const left = Math.max(
		margin,
		Math.min(point.x, win.innerWidth - rect.width - margin),
	);
	const top = Math.max(
		margin,
		Math.min(point.y, win.innerHeight - rect.height - margin),
	);
	panel.style.left = `${left}px`;
	panel.style.top = `${top}px`;
}

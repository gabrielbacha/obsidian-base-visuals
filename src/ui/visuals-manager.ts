import { App, Modal } from 'obsidian';
import { SettingsStore } from '../core/settings-store';
import { ColorPopover } from './color-popover';
import { PillColorManagerView } from './pill-color-manager';
import { RuleManagerView } from './rule-manager';

type ManagerSection = 'pill-colors' | 'conditional-formatting';

export class BasesVisualsModal extends Modal {
	private activeView: PillColorManagerView | RuleManagerView | null = null;
	private section: ManagerSection;

	constructor(
		app: App,
		private readonly store: SettingsStore,
		private readonly popover: ColorPopover,
		private readonly priorityProperties: string[] = [],
		initialSection: ManagerSection = 'conditional-formatting',
	) {
		super(app);
		this.section = initialSection;
	}

	onOpen(): void {
		this.modalEl.addClass('bpc-visuals-modal');
		this.setTitle('Bases visuals');
		this.render();
	}

	onClose(): void {
		this.activeView?.unmount();
		this.activeView = null;
		this.popover.close();
		this.contentEl.empty();
	}

	private render(): void {
		this.activeView?.unmount();
		this.activeView = null;
		this.contentEl.empty();

		const tabs = this.contentEl.createDiv('bpc-visuals-tabs');
		tabs.setAttribute('role', 'tablist');
		tabs.setAttribute('aria-label', 'Visual manager');
		this.createTab(tabs, 'pill-colors', `Pill colors · ${this.store.allOptions().length}`);
		this.createTab(tabs, 'conditional-formatting', `Conditional formatting · ${this.store.settings.rules.length}`);

		const panel = this.contentEl.createDiv('bpc-visuals-panel');
		panel.setAttribute('role', 'tabpanel');
		if (this.section === 'pill-colors') {
			this.activeView = new PillColorManagerView(this.app, this.store, this.popover);
		} else {
			this.activeView = new RuleManagerView(this.app, this.store, this.priorityProperties);
		}
		this.activeView.mount(panel);
	}

	private createTab(container: HTMLElement, section: ManagerSection, label: string): void {
		const tab = container.createEl('button', {
			text: label,
			cls: 'bpc-visuals-tab',
			attr: { type: 'button', role: 'tab' },
		});
		const active = section === this.section;
		tab.classList.toggle('is-active', active);
		tab.setAttribute('aria-selected', String(active));
		tab.tabIndex = active ? 0 : -1;
		tab.addEventListener('click', () => {
			if (this.section === section) return;
			this.section = section;
			this.render();
		});
		tab.addEventListener('keydown', (event) => {
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
			event.preventDefault();
			const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
			const current = tabs.indexOf(tab);
			const offset = event.key === 'ArrowRight' ? 1 : -1;
			const next = tabs[(current + offset + tabs.length) % tabs.length];
			next?.click();
			this.contentEl.querySelector<HTMLButtonElement>('.bpc-visuals-tab.is-active')?.focus();
		});
	}
}

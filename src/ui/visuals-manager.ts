import { App, Modal } from 'obsidian';
import { SettingsStore } from '../core/settings-store';
import { ColorPopover } from './color-popover';
import { PillColorManagerView } from './pill-color-manager';
import { RuleManagerView } from './rule-manager';
import { getNativePropertyDisplayName } from '../core/native-table-view';
import { displayPropertyName } from './color-popover';
import { findUnusedOptions } from '../core/unused-options';

type ManagerSection = 'pill-colors' | 'conditional-formatting';

export class BasesVisualsModal extends Modal {
	private activeView: PillColorManagerView | RuleManagerView | null = null;
	private section: ManagerSection;
	private basePropertyIds: ReadonlySet<string> | undefined;
	private propertyScopeRevision = 0;
	private propertyScopeLoading: boolean;

	constructor(
		app: App,
		private readonly store: SettingsStore,
		private readonly popover: ColorPopover,
		private readonly priorityProperties: string[] = [],
		initialSection: ManagerSection = 'pill-colors',
		private readonly tableScope?: HTMLElement,
		private readonly propertyIdsPromise?: Promise<ReadonlySet<string>>,
	) {
		super(app);
		this.section = initialSection;
		this.basePropertyIds = tableScope ? new Set() : undefined;
		this.propertyScopeLoading = Boolean(propertyIdsPromise);
	}

	onOpen(): void {
		this.modalEl.addClass('bpc-visuals-modal');
		this.setTitle('Bases visuals');
		this.render();
		const revision = ++this.propertyScopeRevision;
		void this.propertyIdsPromise?.then((propertyIds) => {
			if (revision !== this.propertyScopeRevision || !this.modalEl.isConnected) return;
			this.basePropertyIds = propertyIds;
			this.propertyScopeLoading = false;
			this.render();
		});
	}

	onClose(): void {
		this.activeView?.unmount();
		this.activeView = null;
		this.popover.close();
		this.propertyScopeRevision += 1;
		this.contentEl.empty();
	}

	private render(): void {
		this.activeView?.unmount();
		this.activeView = null;
		this.contentEl.empty();

		const tabs = this.contentEl.createDiv('bpc-visuals-tabs');
		tabs.setAttribute('role', 'tablist');
		tabs.setAttribute('aria-label', 'Visual manager');
		const visibleOptions = this.basePropertyIds
			? this.store.allOptions().filter((option) => this.basePropertyIds?.has(option.propertyId))
			: this.store.allOptions();
		this.createTab(
			tabs,
			'pill-colors',
			this.propertyScopeLoading ? 'Pill colors' : `Pill colors · ${visibleOptions.length}`,
		);
		this.createTab(tabs, 'conditional-formatting', `Conditional formatting · ${this.store.settings.rules.length}`);

		const panel = this.contentEl.createDiv('bpc-visuals-panel');
		panel.setAttribute('role', 'tabpanel');
		if (this.section === 'pill-colors') {
			if (this.propertyScopeLoading) {
				panel.createDiv({ text: 'Loading properties from this base…', cls: 'bpc-empty-state' });
				return;
			}
			this.activeView = new PillColorManagerView(
				this.app,
				this.store,
				this.popover,
				true,
				(propertyId) => this.tableScope
					? getNativePropertyDisplayName(this.app, this.tableScope, propertyId) ?? displayPropertyName(propertyId)
					: displayPropertyName(propertyId),
				this.tableScope
					? () => findUnusedOptions(
						this.app,
						this.tableScope!,
						visibleOptions,
						this.store.allKnownProperties().filter((propertyId) =>
							this.basePropertyIds?.has(propertyId) ?? true),
					)
					: undefined,
				this.basePropertyIds,
			);
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

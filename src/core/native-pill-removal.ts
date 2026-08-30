import { Notice } from 'obsidian';

export type PillRemovalResult = 'dispatched' | 'unavailable';

export interface PillRemovalCapability {
	readonly available: boolean;
	remove(): PillRemovalResult;
}

const REMOVE_SELECTOR = [
	'.multi-select-pill-remove-button',
	'button[aria-label*="remove" i]',
	'button[aria-label*="delete" i]',
	'[role="button"][aria-label*="remove" i]',
].join(',');

export class NativePillRemovalService {
	private readonly verificationTimers = new Set<{ win: Window; timer: number }>();
	private readonly dispatching = new WeakSet<HTMLElement>();
	private lastNoticeAt = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly notify: (message: string) => void = (message) => { new Notice(message); },
	) {}

	capability(pill: HTMLElement): PillRemovalCapability {
		return {
			get available() { return findRemoveControl(pill) !== null; },
			remove: () => this.remove(pill),
		};
	}

	remove(pill: HTMLElement): PillRemovalResult {
		const control = findRemoveControl(pill);
		if (!control) {
			this.notifyCompatibilityIssue();
			return 'unavailable';
		}
		const value = pill.querySelector<HTMLElement>('.multi-select-pill-content')?.textContent?.trim();
		this.dispatching.add(pill);
		try {
			control.click();
		} finally {
			this.dispatching.delete(pill);
		}
		if (!pill.isConnected) return 'dispatched';
		this.verifyLater(pill, value);
		return 'dispatched';
	}

	observeNativeRemoval(pill: HTMLElement): void {
		if (this.dispatching.has(pill)) return;
		const value = pill.querySelector<HTMLElement>('.multi-select-pill-content')?.textContent?.trim();
		this.verifyLater(pill, value);
	}

	dispose(): void {
		for (const pending of this.verificationTimers) pending.win.clearTimeout(pending.timer);
		this.verificationTimers.clear();
	}

	private verifyLater(pill: HTMLElement, value: string | undefined): void {
		const win = pill.ownerDocument.defaultView;
		if (!win) return;
		const pending = { win, timer: 0 };
		pending.timer = win.setTimeout(() => {
			this.verificationTimers.delete(pending);
			const current = pill.querySelector<HTMLElement>('.multi-select-pill-content')?.textContent?.trim();
			if (pill.isConnected && current === value) this.notifyCompatibilityIssue();
		}, 750);
		this.verificationTimers.add(pending);
	}

	private notifyCompatibilityIssue(): void {
		const now = Date.now();
		if (now - this.lastNoticeAt < 2000) return;
		this.lastNoticeAt = now;
		this.notify('Bases Visuals could not remove this pill. Obsidian may have changed its Base editor; the cell was left unchanged.');
	}
}

function findRemoveControl(pill: HTMLElement): HTMLElement | null {
	const control = pill.querySelector<HTMLElement>(REMOVE_SELECTOR);
	if (!control || control.matches(':disabled, [aria-disabled="true"]')) return null;
	return control;
}

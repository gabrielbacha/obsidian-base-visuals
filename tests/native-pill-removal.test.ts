import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativePillRemovalService } from '../src/core/native-pill-removal';

afterEach(() => {
	vi.useRealTimers();
	document.body.replaceChildren();
});

describe('NativePillRemovalService', () => {
	it('resolves a replaced native control at invocation time', () => {
		const notify = vi.fn();
		const service = new NativePillRemovalService(notify);
		const pill = createPill();
		const capability = service.capability(pill);
		expect(capability.available).toBe(false);
		const remove = pill.createEl('button', { cls: 'multi-select-pill-remove-button' });
		remove.addEventListener('click', () => pill.remove());
		expect(capability.available).toBe(true);
		expect(capability.remove()).toBe('dispatched');
		expect(pill.isConnected).toBe(false);
		expect(notify).not.toHaveBeenCalled();
		service.dispose();
	});

	it('reports unavailable removal once within the throttle window', () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const notify = vi.fn();
		const service = new NativePillRemovalService(notify);
		const capability = service.capability(createPill());
		expect(capability.remove()).toBe('unavailable');
		expect(capability.remove()).toBe('unavailable');
		expect(notify).toHaveBeenCalledOnce();
		vi.setSystemTime(2001);
		capability.remove();
		expect(notify).toHaveBeenCalledTimes(2);
		service.dispose();
	});

	it('detects a non-responsive native control and clears verification on dispose', () => {
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		const notify = vi.fn();
		const service = new NativePillRemovalService(notify);
		const pill = createPill();
		pill.createEl('button', { cls: 'multi-select-pill-remove-button' });
		expect(service.capability(pill).remove()).toBe('dispatched');
		vi.advanceTimersByTime(749);
		expect(notify).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(notify).toHaveBeenCalledOnce();

		service.capability(pill).remove();
		service.dispose();
		vi.advanceTimersByTime(1000);
		expect(notify).toHaveBeenCalledOnce();
	});

	it('verifies a direct hover-control click without replacing native editing', () => {
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		const notify = vi.fn();
		const service = new NativePillRemovalService(notify);
		const pill = createPill();
		pill.createEl('button', { cls: 'multi-select-pill-remove-button' });
		service.observeNativeRemoval(pill);
		vi.advanceTimersByTime(750);
		expect(notify).toHaveBeenCalledOnce();
		service.dispose();
	});
});

function createPill(): HTMLElement {
	const pill = document.body.createDiv('multi-select-pill');
	pill.createSpan({ cls: 'multi-select-pill-content', text: 'Done' });
	return pill;
}

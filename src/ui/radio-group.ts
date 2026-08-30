const RADIO_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

export function bindRadioGroup(group: HTMLElement, buttons: readonly HTMLButtonElement[]): void {
	selectRadio(buttons, buttons.find((button) => button.getAttribute('aria-checked') === 'true') ?? buttons[0]);
	for (const button of buttons) {
		button.addEventListener('click', () => selectRadio(buttons, button));
	}
	group.addEventListener('keydown', (event) => {
		if (!RADIO_KEYS.has(event.key)) return;
		const current = (event.target as Element | null)?.closest<HTMLButtonElement>('[role="radio"]');
		const currentIndex = current ? buttons.indexOf(current) : -1;
		if (currentIndex < 0 || buttons.length === 0) return;
		let nextIndex = currentIndex;
		if (event.key === 'Home') nextIndex = 0;
		else if (event.key === 'End') nextIndex = buttons.length - 1;
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
			nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
		} else nextIndex = (currentIndex + 1) % buttons.length;
		event.preventDefault();
		const next = buttons[nextIndex];
		next?.click();
		next?.focus();
	});
}

export function selectRadio(
	buttons: readonly HTMLButtonElement[],
	selected: HTMLButtonElement | undefined,
): void {
	for (const button of buttons) {
		const active = button === selected;
		button.setAttribute('aria-checked', String(active));
		button.tabIndex = active ? 0 : -1;
	}
}

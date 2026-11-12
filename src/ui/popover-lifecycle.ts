/** Owner-document placement and one cleanup boundary for every floating panel. */
export interface PopoverAnchor { left: number; right: number; top: number; bottom?: number }
export interface PopoverPlacement { rect?: PopoverAnchor; point?: {x: number; y: number}; width?: number; beside?: boolean }
export function positionBoundedPopover(panel: HTMLElement, options: PopoverPlacement): void {
	const win = panel.ownerDocument.defaultView;
	if (!win) return;
	const margin = Math.min(12, Math.max(0, Math.min(win.innerWidth, win.innerHeight) / 4));
	const availableWidth = Math.max(1, win.innerWidth - margin * 2), availableHeight = Math.max(1, win.innerHeight - margin * 2);
	panel.classList.add('bpc-bounded-popover');
	panel.style.maxWidth = `${availableWidth}px`;
	panel.style.maxHeight = `${availableHeight}px`;

	if (options.width) panel.style.width = `${Math.min(options.width, availableWidth)}px`;
	const measured = panel.getBoundingClientRect(), width = Math.min(measured.width || options.width || 280, availableWidth), height = Math.min(measured.height || panel.offsetHeight || 280, availableHeight);
	const rect = options.rect;
	let left = options.point?.x ?? rect?.left ?? margin, top = options.point?.y ?? (rect ? (rect.bottom ?? rect.top) + 6 : margin);
	if (rect && options.beside) { left = rect.right + 6; if (left + width > win.innerWidth - margin) left = rect.left - width - 6; top = rect.top; }
	else if (rect && top + height > win.innerHeight - margin && rect.top - height - 6 >= margin) top = rect.top - height - 6;
	panel.style.left = `${Math.max(margin, Math.min(left, win.innerWidth - width - margin))}px`;
	panel.style.top = `${Math.max(margin, Math.min(top, win.innerHeight - height - margin))}px`;
}
export function managePopover(panel: HTMLElement, options: PopoverPlacement & { trigger?: HTMLElement; close(): void; cleanup(): void }): () => void {
	const doc = panel.ownerDocument, win = doc.defaultView;
	let disposed = false;
	const position = () => {
		if (disposed) return;
		if (!panel.isConnected || (options.trigger && !options.trigger.isConnected)) { options.close(); return; }
		positionBoundedPopover(panel, {...options, rect: options.trigger?.getBoundingClientRect() ?? options.rect});
	};
	win?.addEventListener('resize', position);
	win?.addEventListener('scroll', position, true);
	const Mutation = win?.MutationObserver;
	const observer = Mutation ? new Mutation(position) : undefined;
	observer?.observe(doc.body, {childList: true, subtree: true});
	const Resize = win?.ResizeObserver;
	const resize = Resize ? new Resize(position) : undefined;
	resize?.observe(panel);
	position();
	return () => {
		if (disposed) return;
		disposed = true;
		observer?.disconnect(); resize?.disconnect();
		win?.removeEventListener('resize', position); win?.removeEventListener('scroll', position, true);
		options.cleanup();
		if (options.trigger?.isConnected) options.trigger.focus({preventScroll: true});
	};
}

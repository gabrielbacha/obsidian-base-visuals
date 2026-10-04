import { describe, expect, it, vi } from 'vitest';
import { findTextUrls, TextLinks } from '../src/core/text-links';

describe('findTextUrls', () => {
	it('finds each URL and leaves out the punctuation after it', () => {
		const text = 'See https://obsidian.md, then (https://en.wikipedia.org/wiki/Base_(chemistry)). Done.';
		expect(findTextUrls(text).map(({ url }) => url)).toEqual([
			'https://obsidian.md',
			'https://en.wikipedia.org/wiki/Base_(chemistry)',
		]);
		const [first] = findTextUrls(text);
		expect(text.slice(first!.start, first!.end)).toBe('https://obsidian.md');
	});

	it('ignores text that only starts like a URL', () => {
		expect(findTextUrls('http:// and https://')).toEqual([]);
		expect(findTextUrls('no links here')).toEqual([]);
	});
});

describe('TextLinks', () => {
	it('opens nothing for a click on a text element that is being edited', () => {
		const root = document.body.createDiv();
		const cell = root.createDiv({ cls: 'bases-view' }).createDiv({ cls: 'bases-td', attr: { 'data-property': 'note.notes' } });
		const text = cell.createDiv({ cls: 'metadata-input-longtext', text: 'see https://obsidian.md', attr: { contenteditable: 'true', tabindex: '0' } });
		const open = vi.fn();
		const links = new TextLinks(open);
		links.attach(root);
		links.updateCell(cell);
		text.focus();
		text.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }));
		expect(open).not.toHaveBeenCalled();
		links.dispose();
		root.remove();
	});
});

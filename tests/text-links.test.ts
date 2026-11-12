import { JSDOM } from 'jsdom';
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


it('uses a separate document for URL click, hover and focus events', () => {
	const fixture = new JSDOM('<div class="bases-view"><div class="bases-td" data-property="note.links"><div class="metadata-input-longtext" tabindex="0">Generated https://example.invalid/test</div></div></div>');
	const doc=fixture.window.document, root=doc.querySelector('.bases-view') as HTMLElement, cell=doc.querySelector('.bases-td') as HTMLElement, text=doc.querySelector('.metadata-input-longtext') as HTMLElement;
	expect(text instanceof Node).toBe(false);expect(text instanceof fixture.window.Node).toBe(true);
	Object.defineProperty(fixture.window.Range.prototype,'getClientRects',{value:()=>[{left:0,right:100,top:0,bottom:20}]});
	const opened=vi.fn(),links=new TextLinks(opened);links.attach(root);links.updateCell(cell);
	const hover=new fixture.window.MouseEvent('pointermove',{bubbles:true,clientX:4,clientY:4});Object.defineProperty(hover,'pointerType',{value:'mouse'});text.dispatchEvent(hover);expect(text.classList.contains('bpc-text-url-hover')).toBe(true);
	text.dispatchEvent(new fixture.window.MouseEvent('click',{bubbles:true,clientX:4,clientY:4}));expect(opened).toHaveBeenCalledWith('https://example.invalid/test');
	text.focus();text.dispatchEvent(new fixture.window.MouseEvent('click',{bubbles:true,clientX:4,clientY:4}));expect(opened).toHaveBeenCalledTimes(1);
	links.dispose();fixture.window.close();
});

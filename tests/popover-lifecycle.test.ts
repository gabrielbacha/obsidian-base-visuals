import { afterEach, expect, it } from 'vitest';
import { managePopover, positionBoundedPopover } from '../src/ui/popover-lifecycle';
const width=Object.getOwnPropertyDescriptor(window,'innerWidth'),height=Object.getOwnPropertyDescriptor(window,'innerHeight');
afterEach(()=>{if(width)Object.defineProperty(window,'innerWidth',width);if(height)Object.defineProperty(window,'innerHeight',height);document.body.replaceChildren();});
it('bounds a tall floating panel at every corner and returns focus after cleanup',async()=>{
	Object.defineProperty(window,'innerWidth',{value:320,configurable:true});Object.defineProperty(window,'innerHeight',{value:200,configurable:true});
	for(const [left,top] of [[0,0],[300,0],[0,180],[300,180]]){
		const trigger=document.body.createEl('button',{text:'Generated trigger'}),panel=document.body.createDiv();
		const rect={left:left??0,right:(left??0)+20,top:top??0,bottom:(top??0)+20};
		positionBoundedPopover(panel,{rect,width:700});
		expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(12);expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(12);
		expect(panel.style.maxHeight).toBe('176px');expect(panel.style.maxWidth).toBe('296px');
		const close=managePopover(panel,{trigger,rect,width:700,close:()=>panel.remove(),cleanup:()=>panel.remove()});close();expect(document.activeElement).toBe(trigger);trigger.remove();
	}
});
it('removes a panel and its lifetime when the connected parent trigger is removed',async()=>{
	const trigger=document.body.createEl('button'),panel=document.body.createDiv();let cleanup:()=>void=()=>undefined,closed=0;
	cleanup=managePopover(panel,{trigger,close:()=>{closed++;cleanup();},cleanup:()=>panel.remove()});
	trigger.remove();await new Promise(resolve=>setTimeout(resolve,0));expect(closed).toBe(1);expect(panel.isConnected).toBe(false);cleanup();
});

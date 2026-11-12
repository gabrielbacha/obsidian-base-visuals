/* global app, fixtureOpened, fixtureRuleModule, fixtureRuleView -- Generated native test-host APIs. */
import assert from 'node:assert/strict';
export async function verifyPanels(page,ruleCode){
 const panels=[];
 await page.evaluate(code=>{const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,window.require);window.fixtureRuleModule=module.exports;},ruleCode);
 await page.addStyleTag({content:'.bpc-bounded-popover button,.bpc-bounded-popover label,.bpc-bounded-popover input{font-size:20px!important;line-height:1.4!important}'});
 for(const size of [{width:360,height:260},{width:700,height:360}]){
  await page.setViewportSize(size);
  for(const corner of ['top-left','top-right','bottom-left','bottom-right'])for(const kind of ['color','column','appearance','pill-appearance','layout','rule']){
   await page.evaluate(({corner,kind})=>{
    const plugin=app.plugins.getPlugin('bases-pill-colors'),scope=document.querySelector('.bases-view');
    if(!scope)throw new Error('Owned Base scope missing');
    document.getElementById('fixture-anchor')?.remove();
    const rule=kind==='rule'?fixtureRuleModule.openRuleFixture(document,app):undefined;if(rule)window.fixtureRuleView=rule;
    const anchor=rule?.button??document.createElement('button');anchor.id='fixture-anchor';anchor.textContent='Generated anchor';Object.assign(anchor.style,{position:'fixed',left:corner.endsWith('right')?`${innerWidth-28}px`:'4px',top:corner.startsWith('bottom')?`${innerHeight-28}px`:'4px',width:'24px',height:'24px'});document.body.append(anchor);
    const store=plugin.baseStores.forScope(scope);
    if(kind==='rule')anchor.click();
    if(kind==='color')plugin.popover.openAtElement(anchor,{propertyId:'note.status',value:'Todo'},store);
    if(kind==='column')plugin.columnPopover.open({document,point:{x:parseFloat(anchor.style.left),y:parseFloat(anchor.style.top)},propertyId:'note.status',value:'Todo',values:['Todo','Done'],removal:{available:false,reason:'Generated fixture'},anchor,store});
    if(kind==='appearance')plugin.enhancer.columnAppearancePopover.open(anchor,scope,'note.status',()=>undefined);
    if(kind==='pill-appearance')plugin.enhancer.columnPillAppearancePopover.open(anchor,store,'note.status','Generated status',()=>undefined);
    if(kind==='layout')plugin.enhancer.tableLayoutPopover.open(anchor,scope);
   },{corner,kind});
   const panel=page.locator('.bpc-bounded-popover').last();await panel.waitFor();
   const box=await panel.boundingBox();assert(box&&box.x>=0&&box.y>=0&&box.x+box.width<=size.width+1&&box.y+box.height<=size.height+1,`${kind}/${corner} escaped viewport: ${JSON.stringify(box)}`);
   const targets=await panel.locator('button,input:not([type=checkbox]):not([type=radio])').evaluateAll(nodes=>nodes.filter(node=>!node.disabled&&node.getBoundingClientRect().width>0).map(node=>({name:node.getAttribute('aria-label')??node.textContent,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
   assert(targets.every(target=>target.width>=24&&target.height>=24),`Small target ${JSON.stringify(targets.filter(target=>target.width<24||target.height<24))}`);
   for(const control of await panel.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled)').all()){if(!await control.isVisible())continue;await control.evaluate(node=>{node.scrollIntoView({block:'nearest'});node.focus();});assert(await control.evaluate(node=>node.ownerDocument.activeElement===node),`${kind}/${corner} could not focus ${await control.evaluate(node=>node.outerHTML)}`);const controlBox=await control.boundingBox();assert(controlBox&&controlBox.y>=0&&controlBox.y+controlBox.height<=size.height+1);}
   const firstControl=panel.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled)').first();if(await firstControl.count()){await firstControl.focus();await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement!==document.body),'Tab lost keyboard focus');}
   if(kind==='pill-appearance'){
    await panel.locator('.bpc-custom-dropdown__trigger').first().click();const menu=page.locator('.bpc-custom-dropdown__menu');await menu.waitFor();const menuBox=await menu.boundingBox();assert(menuBox&&menuBox.x>=0&&menuBox.y>=0&&menuBox.x+menuBox.width<=size.width+1&&menuBox.y+menuBox.height<=size.height+1);await menu.press('Escape');
   }
   await page.evaluate(async()=>{if(window.fixtureRuleView){await fixtureRuleView.dispose();window.fixtureRuleView=undefined;}const plugin=app.plugins.getPlugin('bases-pill-colors');plugin.popover.close();plugin.columnPopover.close();plugin.enhancer.columnAppearancePopover.close();plugin.enhancer.columnPillAppearancePopover.close();plugin.enhancer.tableLayoutPopover.close();});
   await page.waitForFunction(()=>!document.querySelector('.bpc-bounded-popover'));
   panels.push({kind,corner,...size,targets:targets.length});
  }
 }
 await page.setViewportSize({width:1080,height:900});
 await page.evaluate(()=>document.getElementById('fixture-anchor')?.remove());
 return panels;
}

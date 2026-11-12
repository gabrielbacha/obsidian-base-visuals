/** Source component fixture only; it is never enabled as a plugin or written to a user profile. */
import type { App } from 'obsidian';
import { SettingsStore } from '../src/core/settings-store';
import { RuleManagerView } from '../src/ui/rule-manager';
export function openRuleFixture(doc: Document, app: App): {button: HTMLButtonElement; dispose(): Promise<void>} {
	const store = new SettingsStore(SettingsStore.normalize(null), async () => undefined);
	store.addRule('note.status');
	const rule = store.settings.rules[0];
	if (!rule) throw new Error('Generated legacy rule missing');
	rule.color = {kind:'custom',hex:'#336699'}; delete rule.backgroundOpacity;
	const view = new RuleManagerView(app,store,[],false), container=doc.createElement('div');
	doc.body.append(container); view.mount(container);
	const button=container.querySelector<HTMLButtonElement>('.bpc-rule-color:not(.bpc-rule-font-color)');
	if(!button)throw new Error('Generated rule control missing');
	doc.body.append(button);
	return {button,dispose:async()=>{view.unmount();container.remove();button.remove();await store.dispose();}};
}

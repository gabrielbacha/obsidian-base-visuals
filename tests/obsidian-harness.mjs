const logError = (...values) => process.stderr.write(values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ') + '\n');
const log = (...values) => process.stdout.write(values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ') + '\n');
/* global app, fixtureOpened, fixtureRuleModule, fixtureRuleView -- Generated native test-host APIs. */
// Adapted from the verified FolderToolkit harness. Only fixture plugin identity and temp prefix differ.
import { realpathSync } from 'node:fs';
// Launch an installed Obsidian against a disposable vault and profile.
// Never opens, modifies, or closes the user's existing vault/window.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/gabriel/HQ/Coding/Applications-GB/Full-Products/Quiver-MindfulApps/package.json')('playwright');
import { mkdtemp, mkdir, writeFile, copyFile, readFile, rm } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * `extraPlugins` are plugin folders whose release files are copied (never
 * linked or written back) into the disposable vault with default settings.
 * @param {{ files: Record<string, string>, app?: object, extraPlugins?: string[] }} options
 * @returns {Promise<{ page: import('@playwright/test').Page, vault: string, directory: string, errors: string[], close(): Promise<void> }>}
 */
export async function launchObsidian({ files, app = {}, extraPlugins = [], pluginFolder = 'bases-pill-colors' }) {
	if (path.basename(pluginFolder) !== pluginFolder || ['.', '..'].includes(pluginFolder)) throw new Error('Fixture plugin folder must be one component.');
	const executable = process.env.OBSIDIAN_EXECUTABLE;
	if (!executable) throw new Error('Set OBSIDIAN_EXECUTABLE to the installed Obsidian executable.');
	const directory = await mkdtemp(path.join(tmpdir(), 'bases-pill-runtime-'));
	const profile = path.join(directory, 'profile');
	const vault = path.join(directory, 'vault');
	const plugin = path.join(vault, '.obsidian/plugins', pluginFolder);
	await mkdir(profile, { recursive: true });
	await mkdir(plugin, { recursive: true });
	const artifactHashes = {};
	for (const name of ['main.js', 'manifest.json', 'styles.css']) {
		const source = await readFile(name);
		await copyFile(name, path.join(plugin, name));
		artifactHashes[name] = createHash('sha256').update(source).digest('hex');
		if (createHash('sha256').update(await readFile(path.join(plugin, name))).digest('hex') !== artifactHashes[name]) {
			throw new Error(`Fixture artifact differs from built source: ${name}`);
		}
	}
	if (process.env.OBSIDIAN_ASAR) await copyFile(process.env.OBSIDIAN_ASAR, path.join(profile, path.basename(process.env.OBSIDIAN_ASAR)));
	await writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({ updateDisabled: true, vaults: { '0123456789abcdef': { path: vault, ts: Date.now(), open: true } } }));
	await writeFile(path.join(vault, '.obsidian/window.app.json'), JSON.stringify({ livePreview: true, ...app }));
	const pluginIds = ['bases-pill-colors'];
	for (const source of extraPlugins) {
		const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
		const target = path.join(vault, '.obsidian/plugins', manifest.id);
		await mkdir(target, { recursive: true });
		for (const name of ['main.js', 'manifest.json', 'styles.css']) {
			await copyFile(path.join(source, name), path.join(target, name)).catch(error => {
				if (name !== 'styles.css') throw error;
			});
		}
		pluginIds.push(manifest.id);
	}
	await writeFile(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(pluginIds));
	if (process.env.OBSIDIAN_THEME_DIR) {
		const name = path.basename(process.env.OBSIDIAN_THEME_DIR);
		const theme = path.join(vault, '.obsidian/themes', name);
		await mkdir(theme, { recursive: true });
		for (const file of ['theme.css', 'manifest.json']) await copyFile(path.join(process.env.OBSIDIAN_THEME_DIR, file), path.join(theme, file));
		await writeFile(path.join(vault, '.obsidian/appearance.json'), JSON.stringify({ cssTheme: name, accentColor: '#440acd', baseFontSize: 16 }));
	}
	for (const [name, content] of Object.entries(files)) {
		const target = path.resolve(vault, name), relative = path.relative(vault, target);
		if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Fixture path is outside its generated vault.');
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, content);
	}
	log('Disposable test vault:', vault);
	const args = [
		`--user-data-dir=${profile}`,
		'--remote-debugging-port=0',
		'--enable-automation',
		// A hidden window must keep rendering and running timers normally.
		'--disable-renderer-backgrounding',
		'--disable-background-timer-throttling',
		'--disable-backgrounding-occluded-windows',
	];
	// On macOS, start the test app hidden and without taking focus, so it never
	// interrupts the user. FOLDER_TOOLKIT_TEST_VISIBLE=1 shows it instead.
	const bundle = executable.match(/^(.*?\.app)\//u)?.[1];
	const background = process.platform === 'darwin' && bundle && !process.env.FOLDER_TOOLKIT_TEST_VISIBLE;
	if (background) spawn('open', ['-g', '-j', '-n', '-a', bundle, '--args', ...args], { stdio: 'ignore' });
	else spawn(executable, args, { stdio: 'ignore' });
	let browser;
	const errors = [];
	const close = async () => {
		await browser?.close().catch(() => {});
		// Only processes started with this run's unique temporary profile:
		// never find or terminate the user's own Obsidian.
		const pids = async () => {
			try {
				const { stdout } = await promisify(execFile)('pgrep', ['-f', '--', `--user-data-dir=${profile}`]);
				return stdout.split('\n').filter(Boolean).map(Number);
			} catch { return []; }
		};
		for (const pid of await pids()) { try { process.kill(pid, 'SIGTERM'); } catch { /* The owned test process has already closed. */ } }
		await new Promise(resolve => setTimeout(resolve, 1500));
		for (const pid of await pids()) { try { process.kill(pid, 'SIGKILL'); } catch { /* The owned test process has already closed. */ } }
		await new Promise(resolve => setTimeout(resolve, 100));
		if ((await pids()).length) throw new Error('The owned native test process did not stop; its fixture was retained.');
		await rm(directory, { recursive: true, force: true });
	};
	try {
		let port;
		for (let attempt = 0; attempt < 100; attempt++) {
			try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { /* The owned test process has already closed. */ }
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		if (!port) throw new Error('Isolated Obsidian did not expose its test debugging port.');
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		const context = browser.contexts()[0];
		const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 20000 });
		// Prove both native profile and vault bindings before any trust, focus or editor action.
		const normalize=value=>realpathSync(path.resolve(value));
		const proofSession=await context.newCDPSession(page);
		const command=await proofSession.send('Browser.getBrowserCommandLine');
		if(!command.arguments.some(value=>value===`--user-data-dir=${profile}`)||!command.arguments.some(value=>normalize(value)===normalize(executable)))throw new Error('The debug session does not belong to this executable and generated profile.');
		const nativeProfile=await page.evaluate(()=>{for(const name of ['@electron/remote','electron']){try{const load=window.require??(typeof require==='function'?require:undefined);const module=load?.(name),nativeApp=module?.app??module?.remote?.app;if(nativeApp?.getPath)return nativeApp.getPath('userData');}catch{/* Try the next supported host bridge. */}}return null;});
		if(!nativeProfile||normalize(nativeProfile)!==normalize(profile))throw new Error('Native user-data isolation could not be proved; no UI action was taken.');
		await page.waitForFunction(()=>Boolean(window.app?.vault?.adapter?.getBasePath),undefined,{timeout:20000});
		const boundVault=await page.evaluate(()=>window.app.vault.adapter.getBasePath());
		if(normalize(boundVault)!==normalize(vault))throw new Error('The test app opened an unexpected vault; no UI action was taken.');
		await context.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname)||['app:','file:','data:','blob:','devtools:'].includes(url.protocol))return route.continue();return route.abort('blockedbyclient');});
		log('PASS: executable, native user-data directory and fixture vault are verified before UI actions.');
		page.setDefaultTimeout(15000);
		// The hidden window never has OS focus; let the page behave as focused.
		const session = await context.newCDPSession(page);
		await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
		// Quitting the disposable app can race Electron's before-unload dialog.
		// Handle that explicitly instead of Playwright's automatic dialog handler.
		page.on('dialog', dialog => { void dialog.accept().catch(() => {}); });
		page.on('pageerror', error => { errors.push(error.message); logError('Renderer error:', error.message); });
		page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); logError('Console:', message.text()); } });
		const trust = page.getByRole('button', { name: 'Trust author and enable plugins', exact: true });
		await trust.waitFor({ state: 'visible' });
		await trust.click();
		await page.waitForFunction(() => window.app?.workspace?.layoutReady, undefined, { timeout: 20000 });
		await page.evaluate(async ids => {
			await window.app.plugins.setEnable(true);
			for (const id of ids) if (!window.app.plugins.enabledPlugins.has(id)) await window.app.plugins.enablePlugin(id);
		}, pluginIds);
		const loaded = await page.evaluate(async pluginFolder => {
			const instance = window.app.plugins.getPlugin('bases-pill-colors');
			const directory = window.app.plugins.manifests['bases-pill-colors']?.dir;
			if (!instance || directory !== '.obsidian/plugins/' + pluginFolder) throw new Error('The plugin did not load from the fixture directory.');
			const artifacts = {};
			for (const name of ['main.js', 'manifest.json', 'styles.css']) artifacts[name] = await window.app.vault.adapter.read(`${directory}/${name}`);
			return { id: instance.manifest.id, version: instance.manifest.version, artifacts };
		}, pluginFolder);
		const sourceManifest = JSON.parse(await readFile('manifest.json', 'utf8'));
		if (loaded.id !== sourceManifest.id || loaded.version !== sourceManifest.version) throw new Error('Loaded plugin identity does not match the built manifest.');
		for (const [name, content] of Object.entries(loaded.artifacts)) {
			if (createHash('sha256').update(content).digest('hex') !== artifactHashes[name]) throw new Error(`Host artifact differs from the tested build: ${name}`);
		}
		log('PASS: fixture load directory, plugin identity and SHA-256 of all three built artifacts match.', JSON.stringify(artifactHashes));
		return { page, vault, directory, errors, close };
	} catch (error) {
		await close();
		throw error;
	}
}

/** Open a note in Live Preview in the current leaf. */
export async function openLivePreview(page, file) {
	await page.evaluate(async file => {
		const leaf = window.app.workspace.getLeaf();
		await leaf.openFile(window.app.vault.getAbstractFileByPath(file));
		await leaf.setViewState({ type: 'markdown', state: { file, mode: 'source', source: false } });
	}, file);
}

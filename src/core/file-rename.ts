import { noteNameFrom, uniqueName } from '@gabrielbacha/bases-contract';
import { normalizePath, type App, type TFile } from 'obsidian';
import { getNativeBaseFile, getNativeResultFiles } from './native-table-view';

const FILE_LINK_SELECTOR = 'a[data-href], a.internal-link, a[href]';

export function resolveFileFromNameCell(
	app: App,
	scope: HTMLElement,
	cell: HTMLElement,
): TFile | null {
	const link = cell.querySelector<HTMLAnchorElement>(FILE_LINK_SELECTOR);
	const rawTarget = link?.dataset.href?.trim()
		?? link?.getAttribute('data-href')?.trim()
		?? link?.getAttribute('href')?.trim()
		?? link?.textContent?.trim()
		?? '';
	const target = rawTarget && !rawTarget.startsWith('#') ? decodeLinkTarget(rawTarget) : '';
	const sourcePath = getNativeBaseFile(app, scope)?.path ?? '';
	const linkedFile = target ? app.metadataCache?.getFirstLinkpathDest(target, sourcePath) : null;
	if (linkedFile) return linkedFile;

	const nativeFiles = getNativeResultFiles(app, scope);
	const hints = fileHints(target, link?.textContent ?? cell.textContent ?? '');
	for (const hint of hints) {
		const matches = nativeFiles.filter((file) => fileMatchesHint(file, hint));
		if (matches.length === 1) return matches[0] ?? null;
	}

	// Positional matching is safe only when every native result row is present.
	// That avoids guessing when Obsidian has virtualized part of a long table.
	const row = cell.closest<HTMLElement>('.bases-tr');
	const renderedRows = [...scope.querySelectorAll<HTMLElement>('.bases-tr')]
		.filter((candidate) => !candidate.closest('.bases-thead'));
	if (row && nativeFiles.length === renderedRows.length) {
		const index = renderedRows.indexOf(row);
		if (index >= 0) return nativeFiles[index] ?? null;
	}
	return null;
}

/**
 * Renames a file in place, keeping its folder and extension. What was typed is made into a valid
 * name the way BaseStudio does (the shared `noteNameFrom`), and a name already used in the folder
 * gets " 2", " 3"… (`uniqueName`), in place of refusing the rename.
 */
export async function renameFileBasename(
	app: App,
	file: TFile,
	requestedName: string,
): Promise<'renamed' | 'unchanged'> {
	const typed = stripExtension(requestedName.trim(), file.extension);
	if (!typed) throw new Error('File name cannot be empty.');
	const extension = file.extension ? `.${file.extension}` : '';
	const parentPath = file.parent?.path ?? '';
	const pathOf = (basename: string) => normalizePath(`${parentPath ? `${parentPath}/` : ''}${basename}${extension}`);
	const wanted = noteNameFrom(typed);
	if (pathOf(wanted) === file.path) return 'unchanged';
	const basename = uniqueName(wanted, (candidate) => {
		const existing = app.vault.getAbstractFileByPath(pathOf(candidate));
		return Boolean(existing) && existing !== file;
	});
	const targetPath = pathOf(basename);
	if (targetPath === file.path) return 'unchanged';
	await app.fileManager.renameFile(file, targetPath);
	return 'renamed';
}

function stripExtension(name: string, extension: string): string {
	const suffix = extension ? `.${extension}` : '';
	return suffix && name.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())
		? name.slice(0, -suffix.length).trim()
		: name;
}

function decodeLinkTarget(target: string): string {
	try {
		return decodeURIComponent(target);
	} catch {
		return target;
	}
}

function fileHints(target: string, visibleText: string): string[] {
	const hints = new Set<string>();
	const add = (value: string) => {
		const normalized = value.trim().replace(/^\/+|\/+$/g, '');
		if (normalized) hints.add(normalized);
	};
	add(visibleText);
	add(target);
	if (target) {
		try {
			const url = new URL(target);
			for (const key of ['file', 'path']) add(decodeLinkTarget(url.searchParams.get(key) ?? ''));
			add(decodeLinkTarget(url.pathname));
		} catch {
			// Linkpaths such as `Folder/Note` are intentionally not URLs.
		}
	}
	return [...hints];
}

function fileMatchesHint(file: TFile, rawHint: string): boolean {
	const hint = rawHint
		.replace(/[?#].*$/u, '')
		.replace(/^\/+|\/+$/g, '')
		.trim();
	if (!hint) return false;
	const withoutExtension = hint.toLocaleLowerCase().endsWith('.md') ? hint.slice(0, -3) : hint;
	const filePathWithoutExtension = file.path.toLocaleLowerCase().endsWith('.md')
		? file.path.slice(0, -3)
		: file.path;
	return [file.path, filePathWithoutExtension, file.name, file.basename]
		.some((candidate) => candidate.localeCompare(hint, undefined, { sensitivity: 'base' }) === 0 ||
			candidate.localeCompare(withoutExtension, undefined, { sensitivity: 'base' }) === 0) ||
		file.path.toLocaleLowerCase().endsWith(`/${hint.toLocaleLowerCase()}`) ||
		filePathWithoutExtension.toLocaleLowerCase().endsWith(`/${withoutExtension.toLocaleLowerCase()}`);
}

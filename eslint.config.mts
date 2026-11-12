import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'tests/baseline',
		'dist',
		'esbuild.config.mjs',
		'scripts/bundle-smoke.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['tests/**/*.mjs', 'scripts/filename-contract.mjs'],
		extends: [tseslint.configs.disableTypeChecked],
		languageOptions: { globals: { ...globals.browser, ...globals.node }, parserOptions: { projectService: false } },
	},
	{
		files: ['tests/native-panels.mjs', 'tests/performance-before-after.test.ts'],
		rules: {
			// These fixtures execute only checksum-verified, locally built source.
			'obsidianmd/rule-custom-message': 'off',
		},
	},
	{
		files: ['tests/**/*.ts'],
		languageOptions: { globals: { ...globals.node } },
	},
	{
		files: ['tests/setup.ts'],
		rules: {
			// The setup file defines these Obsidian DOM helpers for jsdom.
			'obsidianmd/prefer-create-el': 'off',
		},
	},
);

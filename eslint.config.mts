import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
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
		files: ['tests/setup.ts'],
		rules: {
			// The setup file defines these Obsidian DOM helpers for jsdom.
			'obsidianmd/prefer-create-el': 'off',
		},
	},
	{
		files: ['tests/obsidian.ts'],
		rules: {
			// The Obsidian test double re-exports the same Moment instance that Obsidian bundles in production.
			'@typescript-eslint/no-restricted-imports': 'off',
			'import/no-extraneous-dependencies': 'off',
		},
	},
);

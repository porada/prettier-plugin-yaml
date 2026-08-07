import { defineOxlintConfig } from '@standard-config/oxlint';
import { configDefaults, defineConfig } from 'vite-plus';

export default defineConfig({
	test: {
		exclude: [
			/* prettier-ignore */
			...configDefaults.exclude,
			'.agent-*/**',
		],
		typecheck: {
			enabled: true,
		},
	},
	lint: defineOxlintConfig({
		rules: {
			'typescript/no-restricted-types': 'off',
		},
	}),
	pack: {
		deps: {
			neverBundle: true,
		},
		entry: 'src/index.ts',
		failOnWarn: true,
		publint: true,
	},
	staged: {
		'*': [
			() => 'pnpm install --ignore-scripts',
			'prettier --ignore-unknown --write',
			() => 'pnpm prepack',
		],
	},
});

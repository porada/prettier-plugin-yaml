import { defineOxlintConfig } from '@standard-config/oxlint';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	test: {
		coverage: {
			exclude: [
				/* prettier-ignore */
				'**/coverage/**',
				'**/dist/**',
			],
			enabled: true,
			reporter: [
				/* prettier-ignore */
				'json',
				['text', { skipFull: true }],
			],
			thresholds: {
				100: true,
			},
		},
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
			() => 'pnpm install --frozen-lockfile --ignore-scripts',
			() => 'pnpm build',
			'prettier --ignore-unknown --write',
			() => 'pnpm prepack',
		],
	},
});

import { defineOxlintConfig } from '@standard-config/eslint/utilities';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	test: {
		typecheck: {
			enabled: true,
		},
	},
	lint: defineOxlintConfig(),
	pack: {
		deps: {
			skipNodeModulesBundle: true,
		},
		dts: {
			sourcemap: true,
		},
		entry: 'src/index.ts',
		failOnWarn: true,
		publint: true,
		sourcemap: true,
	},
	staged: {
		'*': [
			() => 'pnpm install --ignore-scripts',
			'prettier --ignore-unknown --write',
			() => 'pnpm prepack',
		],
	},
});

import { defineConfig } from 'tsdown';

export default defineConfig({
	dts: {
		sourcemap: true,
	},
	entry: 'src/index.ts',
	failOnWarn: true,
	publint: true,
	skipNodeModulesBundle: true,
	sourcemap: true,
});

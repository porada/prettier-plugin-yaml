import { defineConfig } from 'tsdown';

export default defineConfig({
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
});

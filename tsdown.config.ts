import { defineConfig } from 'tsdown';

export default defineConfig({
	dts: {
		sourcemap: true,
	},
	entry: './src/index.ts',
	publint: true,
	sourcemap: true,
});

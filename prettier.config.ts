import { defineConfig } from '@standard-config/prettier';
import * as pluginYAML from './src/index.ts';

export default defineConfig({
	/* oxlint-disable-next-line typescript/no-deprecated */
	pluginOverrides: {
		'prettier-plugin-yaml': pluginYAML,
	},
});

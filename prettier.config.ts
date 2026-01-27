import { defineConfig } from '@standard-config/prettier';
import * as pluginYAML from './src/index.ts';

export default defineConfig({
	pluginOverrides: {
		'prettier-plugin-yaml': pluginYAML,
	},
});

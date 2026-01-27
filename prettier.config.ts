import { defineConfig } from '@standard-config/prettier';
import * as pluginYAML from './src/index.ts';

const config = defineConfig();

config.plugins!.push(pluginYAML);

export default config;

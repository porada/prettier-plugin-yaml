import { getOxlintConfigs } from '@standard-config/eslint/utilities';
import { defineConfig } from '@standard-config/oxlint';

const { configBase } = getOxlintConfigs();

export default defineConfig(configBase);

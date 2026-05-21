import type { Options as PrettierOptions } from 'prettier';
import type { PluginOptions, PluginWithParsers } from './index.d.ts';
import { expectTypeOf, test } from 'vitest';

test('exposes valid types', () => {
	expectTypeOf<PluginOptions>().toBeObject();
	expectTypeOf<PluginOptions>().toHaveProperty('yamlBlockStyle');
	expectTypeOf<PluginOptions>().toHaveProperty('yamlCollectionStyle');
	expectTypeOf<PluginOptions>().toHaveProperty('yamlQuoteKeys');
	expectTypeOf<PluginOptions>().toHaveProperty('yamlQuoteValues');
	expectTypeOf<PluginOptions>().toHaveProperty('yamlQuoteValuesMatching');

	expectTypeOf<PluginWithParsers>().toBeObject();
	expectTypeOf<PluginWithParsers>().toHaveProperty('parsers');
});

test('extends Prettier’s `Options`', () => {
	expectTypeOf<PrettierOptions>().toBeObject();
	expectTypeOf<PrettierOptions>().toHaveProperty('useTabs');

	expectTypeOf<PrettierOptions>().toHaveProperty('yamlBlockStyle');
	expectTypeOf<PrettierOptions>().toHaveProperty('yamlCollectionStyle');
	expectTypeOf<PrettierOptions>().toHaveProperty('yamlQuoteKeys');
	expectTypeOf<PrettierOptions>().toHaveProperty('yamlQuoteValues');
	expectTypeOf<PrettierOptions>().toHaveProperty('yamlQuoteValuesMatching');
});

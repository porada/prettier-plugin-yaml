import type { Options as PrettierOptions } from 'prettier';
import type {
	ParserHookName,
	ParserInitializer,
	ParseWithCompatibility,
	PluginOptions,
	PluginWithParsers,
	PreprocessState,
	ResolvedPriorParser,
} from './index.d.ts';
import { expectTypeOf, test } from 'vite-plus/test';

test('exposes valid types', () => {
	expectTypeOf<PluginOptions>().toBeObject();
	expectTypeOf<PluginOptions>().toHaveProperty('yamlBlockStyle');
	expectTypeOf<PluginOptions>().toHaveProperty('yamlCollectionStyle');
	expectTypeOf<PluginOptions>().toHaveProperty('yamlQuoteKeys');
	expectTypeOf<PluginOptions>().toHaveProperty('yamlQuoteKeysMatching');
	expectTypeOf<PluginOptions>().toHaveProperty('yamlQuoteValues');
	expectTypeOf<PluginOptions>().toHaveProperty('yamlQuoteValuesMatching');

	expectTypeOf<ParserHookName>().toEqualTypeOf<'parse' | 'preprocess'>();

	expectTypeOf<ParserInitializer>().toBeFunction();

	expectTypeOf<ParseWithCompatibility>().toBeFunction();

	expectTypeOf<PluginWithParsers>().toBeObject();
	expectTypeOf<PluginWithParsers>().toHaveProperty('parsers');

	expectTypeOf<PreprocessState>().toBeObject();
	expectTypeOf<PreprocessState>().toHaveProperty('preserveSourcePositions');

	expectTypeOf<ResolvedPriorParser>().toBeObject();
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('parser');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('plugins');
});

test('extends Prettier’s `Options`', () => {
	expectTypeOf<PrettierOptions>().toBeObject();
	expectTypeOf<PrettierOptions>().toHaveProperty('useTabs');

	expectTypeOf<PrettierOptions>().toHaveProperty('yamlBlockStyle');
	expectTypeOf<PrettierOptions>().toHaveProperty('yamlCollectionStyle');
	expectTypeOf<PrettierOptions>().toHaveProperty('yamlQuoteKeys');
	expectTypeOf<PrettierOptions>().toHaveProperty('yamlQuoteKeysMatching');
	expectTypeOf<PrettierOptions>().toHaveProperty('yamlQuoteValues');
	expectTypeOf<PrettierOptions>().toHaveProperty('yamlQuoteValuesMatching');
});

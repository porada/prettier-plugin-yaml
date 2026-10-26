import type { ParserOptions, Options as PrettierOptions } from 'prettier';
import type {
	ParserDelegation,
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
	expectTypeOf<PluginOptions>()
		.toHaveProperty('yamlBlockStyle')
		.toEqualTypeOf<'folded' | 'literal' | undefined>();
	expectTypeOf<PluginOptions>()
		.toHaveProperty('yamlCollectionStyle')
		.toEqualTypeOf<'block' | 'flow' | undefined>();
	expectTypeOf<PluginOptions>()
		.toHaveProperty('yamlQuoteKeys')
		.toEqualTypeOf<boolean | undefined>();
	expectTypeOf<PluginOptions>()
		.toHaveProperty('yamlQuoteKeysMatching')
		.toEqualTypeOf<string | undefined>();
	expectTypeOf<PluginOptions>()
		.toHaveProperty('yamlQuoteValues')
		.toEqualTypeOf<boolean | undefined>();
	expectTypeOf<PluginOptions>()
		.toHaveProperty('yamlQuoteValuesMatching')
		.toEqualTypeOf<string | undefined>();

	expectTypeOf<ParserDelegation>().toEqualTypeOf<{
		hook: ParserHookName;
		parserName: 'yaml';
		resolveNext: () => Promise<ResolvedPriorParser | undefined>;
	}>();

	expectTypeOf<ParserHookName>().toEqualTypeOf<'parse' | 'preprocess'>();

	expectTypeOf<ParserInitializer>().toBeFunction();

	expectTypeOf<ParseWithCompatibility>().toBeFunction();

	expectTypeOf<PluginWithParsers>().toBeObject();
	expectTypeOf<PluginWithParsers>().toHaveProperty('parsers');

	expectTypeOf<PreprocessState>().toBeObject();
	expectTypeOf<PreprocessState>().toHaveProperty('preserveSourcePositions');

	expectTypeOf<ResolvedPriorParser>().toBeObject();
	expectTypeOf<
		Pick<ResolvedPriorParser, 'delegation' | 'entryOptions'>
	>().toEqualTypeOf<{
		delegation?: ParserDelegation;
		entryOptions?: Pick<ParserOptions, 'locEnd' | 'locStart' | 'plugins'>;
	}>();
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('lifecycleState');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('parser');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('plugins');
});

test('extends Prettier’s `Options`', () => {
	expectTypeOf<PrettierOptions>().toBeObject();
	expectTypeOf<PrettierOptions>().toHaveProperty('useTabs');

	expectTypeOf<PrettierOptions>()
		.toHaveProperty('yamlBlockStyle')
		.toEqualTypeOf<'folded' | 'literal' | undefined>();
	expectTypeOf<PrettierOptions>()
		.toHaveProperty('yamlCollectionStyle')
		.toEqualTypeOf<'block' | 'flow' | undefined>();
	expectTypeOf<PrettierOptions>()
		.toHaveProperty('yamlQuoteKeys')
		.toEqualTypeOf<boolean | undefined>();
	expectTypeOf<PrettierOptions>()
		.toHaveProperty('yamlQuoteKeysMatching')
		.toEqualTypeOf<string | undefined>();
	expectTypeOf<PrettierOptions>()
		.toHaveProperty('yamlQuoteValues')
		.toEqualTypeOf<boolean | undefined>();
	expectTypeOf<PrettierOptions>()
		.toHaveProperty('yamlQuoteValuesMatching')
		.toEqualTypeOf<string | undefined>();
});

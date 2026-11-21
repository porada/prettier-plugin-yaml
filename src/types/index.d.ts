import type { Parser, ParserOptions, Plugin } from 'prettier';

export interface PluginOptions {
	/**
	 * Set the block style for multi-line strings outside flow collections.
	 * `folded` uses `>` and `literal` uses `|`.
	 */
	yamlBlockStyle?: 'folded' | 'literal' | undefined;
	/**
	 * Format maps and sequences with indentation and dashes in `block` style,
	 * or braces and brackets in `flow` style.
	 */
	yamlCollectionStyle?: 'block' | 'flow' | undefined;
	/**
	 * Quote all scalar mapping keys. Preserves YAML merge keys and explicitly
	 * tagged non-string keys. Removes unnecessary quotes when disabled.
	 *
	 * @default false
	 */
	yamlQuoteKeys?: boolean | undefined;
	/**
	 * Quote scalar mapping keys that match a regular expression. Matches
	 * non-string keys by their string representation. Preserves YAML merge keys
	 * and explicitly tagged non-string keys. Doesn’t affect keys that must be
	 * quoted anyway.
	 */
	yamlQuoteKeysMatching?: string | undefined;
	/**
	 * Quote all string values. Takes precedence over `yamlBlockStyle`. Removes
	 * unnecessary quotes when disabled.
	 *
	 * @default false
	 */
	yamlQuoteValues?: boolean | undefined;
	/**
	 * Quote values that match a regular expression. Matches non-string values
	 * by their string representation. Preserves explicitly tagged non-string
	 * values. Takes precedence over `yamlBlockStyle`. Doesn’t affect values
	 * that must be quoted anyway.
	 */
	yamlQuoteValuesMatching?: string | undefined;
}

declare module 'prettier' {
	interface Options extends PluginOptions {}
}

export type ParserDelegation = {
	hook: ParserHookName;
	parserName: 'yaml';
	resolveNext: () => Promise<ResolvedPriorParser | undefined>;
};

export type ParserHookName = 'parse' | 'preprocess';

export type ParserInitializer = () => Parser | Promise<Parser>;

export type ParseWithCompatibility = (
	this: Parser,
	text: string,
	options: ParserOptions,
	optionsForCompatibility: ParserOptions
) => unknown;

export type PluginWithParsers = Omit<Plugin, 'parsers'> & {
	parsers: Record<string, Parser | ParserInitializer>;
};

export type PreprocessState = {
	preserveSourcePositions: boolean;
};

export type ResolvedPriorParser = {
	delegation?: ParserDelegation;
	entryOptions?: Pick<ParserOptions, 'locEnd' | 'locStart' | 'plugins'>;
	lifecycleState: Partial<
		Pick<ParserOptions, 'locEnd' | 'locStart' | 'plugins'>
	>;
	parser: Parser;
	plugins: ParserOptions['plugins'];
};

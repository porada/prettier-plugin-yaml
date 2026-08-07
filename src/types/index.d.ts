import type { Plugin } from 'prettier';

export interface PluginOptions {
	/**
	 * Enforce a single block style for multi-line string values. Does not apply
	 * to flow collections.
	 */
	yamlBlockStyle?: 'folded' | 'literal' | undefined;
	/**
	 * Enforce a single collection style for maps and sequences.
	 */
	yamlCollectionStyle?: 'block' | 'flow' | undefined;
	/**
	 * Quote all scalar mapping keys. Leaves YAML merge keys and explicitly
	 * tagged non-string keys unchanged. Removes unnecessary quotes when disabled.
	 * @default false
	 */
	yamlQuoteKeys?: boolean | undefined;
	/**
	 * Quote keys that match a specific pattern. Non-string keys are matched
	 * based on their string representation. Leaves YAML merge keys and explicitly
	 * tagged non-string keys unchanged. Doesn’t affect keys that must be quoted
	 * anyway.
	 */
	yamlQuoteKeysMatching?: string | undefined;
	/**
	 * Quote all string values. Takes precedence over `yamlBlockStyle`. Removes
	 * unnecessary quotes when disabled.
	 * @default false
	 */
	yamlQuoteValues?: boolean | undefined;
	/**
	 * Quote values that match a specific pattern. Non-string values are matched
	 * based on their string representation. Leaves explicitly tagged non-string
	 * values unchanged. Takes precedence over `yamlBlockStyle`. Doesn’t affect
	 * values that must be quoted anyway.
	 */
	yamlQuoteValuesMatching?: string | undefined;
}

declare module 'prettier' {
	interface Options extends PluginOptions {}
}

export type PluginWithParsers = Omit<Plugin, 'parsers'> & {
	parsers: NonNullable<Plugin['parsers']>;
};

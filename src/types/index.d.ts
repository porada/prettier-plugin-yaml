import type { Plugin } from 'prettier';

export type PluginOptions = {
	/**
	 * Enforce a single collection style for maps and sequences.
	 */
	yamlCollectionStyle?: 'block' | 'flow' | undefined;
	/**
	 * Quote all mapping keys. Removes unnecessary quotes when disabled.
	 * @default false
	 */
	yamlQuoteKeys?: boolean | undefined;
	/**
	 * Quote all string values. Removes unnecessary quotes when disabled.
	 * @default false
	 */
	yamlQuoteValues?: boolean | undefined;
};

declare module 'prettier' {
	interface Options extends PluginOptions {}
}

export type PluginWithParsers = Omit<Plugin, 'parsers'> & {
	parsers: NonNullable<Plugin['parsers']>;
};

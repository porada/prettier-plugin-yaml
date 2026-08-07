import type { Parser, ParserOptions, Plugin } from 'prettier';
import type { PluginOptions, PluginWithParsers } from './types/index.d.ts';
import { parsers as prettierParsers } from 'prettier/plugins/yaml';
import preprocessYAML from './preprocess-yaml/index.ts';

function createParser(): Parser {
	const parse: Parser['parse'] = async (
		text: string,
		options: ParserOptions
	) => {
		const priorParser = findPriorParser(options, parse);

		/* oxlint-disable-next-line typescript/no-unsafe-return */
		return typeof priorParser?.parse === 'function'
			? await priorParser.parse(text, omitCurrentParser(options, parse))
			: prettierParsers.yaml.parse(text, options);
	};

	const preprocess: NonNullable<Parser['preprocess']> = async (
		text: string,
		options: ParserOptions
	) => {
		const priorParser = findPriorParser(options, parse);

		if (typeof priorParser?.preprocess === 'function') {
			/* oxlint-disable-next-line eslint/no-param-reassign */
			text = await priorParser.preprocess(
				text,
				omitCurrentParser(options, parse)
			);
		}

		return preprocessYAML(text, options);
	};

	return {
		...prettierParsers.yaml,
		astFormat: 'yaml',
		parse,
		preprocess,
	};
}

function findPriorParser(
	options: ParserOptions,
	currentParse: Parser['parse']
): Parser | undefined {
	for (const plugin of options.plugins.toReversed()) {
		if (!hasParsers(plugin)) {
			continue;
		}

		const parser = plugin.parsers.yaml;

		if (parser && parser.parse !== currentParse) {
			return parser;
		}
	}

	/* v8 ignore next -- @preserve */
	return undefined;
}

function hasParsers(plugin: unknown): plugin is PluginWithParsers {
	/* v8 ignore if -- @preserve */
	if (!plugin) {
		return false;
	}

	return typeof plugin === 'object' && Object.hasOwn(plugin, 'parsers');
}

function omitCurrentParser(
	options: ParserOptions,
	currentParse: Parser['parse']
): ParserOptions {
	return {
		...options,
		plugins: options.plugins.filter((plugin) => {
			if (!hasParsers(plugin)) {
				return true;
			}

			const parser = plugin.parsers.yaml;
			return !(parser && parser.parse === currentParse);
		}),
	};
}

export const parsers: Plugin['parsers'] = {
	yaml: createParser(),
};

export const options: Plugin['options'] = {
	yamlBlockStyle: {
		category: 'Output',
		description:
			'Enforce a block style for multi-line string values. Does not apply to flow collections.',
		type: 'choice',
		choices: [
			{
				description: 'Use folded block scalars.',
				value: 'folded',
			},
			{
				description: 'Use literal block scalars.',
				value: 'literal',
			},
		],
	},
	yamlCollectionStyle: {
		category: 'Output',
		description: 'Enforce a collection style for maps and sequences.',
		type: 'choice',
		choices: [
			{
				description: 'Use block style.',
				value: 'block',
			},
			{
				description: 'Use flow style.',
				value: 'flow',
			},
		],
	},
	yamlQuoteKeys: {
		category: 'Output',
		description:
			'Quote all mapping keys. Removes unnecessary quotes when disabled.',
		type: 'boolean',
		default: false,
	},
	yamlQuoteKeysMatching: {
		category: 'Output',
		description:
			'Quote keys that match a specific pattern. Matches non-string keys based on their string representation.',
		type: 'string',
	},
	yamlQuoteValues: {
		category: 'Output',
		description:
			'Quote all string values. Takes precedence over `yamlBlockStyle`. Removes unnecessary quotes when disabled.',
		type: 'boolean',
		default: false,
	},
	yamlQuoteValuesMatching: {
		category: 'Output',
		description:
			'Quote values that match a specific pattern. Matches non-string values based on their string representation. Takes precedence over `yamlBlockStyle`.',
		type: 'string',
	},
};

export const defaultOptions: Plugin['defaultOptions'] = {
	useTabs: false,
};

export type { PluginOptions };

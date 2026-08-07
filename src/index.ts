import type { Parser, ParserOptions, Plugin } from 'prettier';
import type { PluginOptions } from './types/index.d.ts';
import { parsers as prettierParsers } from 'prettier/plugins/yaml';
import {
	callParserWithCompatibility,
	createPriorParserResolver,
	markParserAsYAML,
	withPriorParserOptions,
} from './plugin-hooks/index.ts';
import preprocessYAML, {
	createPreprocessState,
} from './preprocess-yaml/index.ts';

function createParser(): Parser {
	async function parse(
		text: string,
		options: ParserOptions
	): Promise<unknown> {
		const resolvedPriorParser = await resolvePriorParser(options, 'parse');
		const priorParser = resolvedPriorParser?.parser;

		if (
			resolvedPriorParser &&
			priorParser &&
			typeof priorParser.parse === 'function' &&
			priorParser.parse !== parse
		) {
			return withPriorParserOptions(
				options,
				resolvedPriorParser,
				(delegatedOptions) =>
					callParserWithCompatibility(
						priorParser,
						text,
						delegatedOptions
					)
			);
		}

		return await prettierParsers.yaml.parse(text, options);
	}

	const preprocess: NonNullable<Parser['preprocess']> = async (
		text: string,
		options: ParserOptions
	) => {
		const preprocessState = createPreprocessState(text, options);
		const resolvedPriorParser = await resolvePriorParser(
			options,
			'preprocess'
		);
		const priorParser = resolvedPriorParser?.parser;
		const priorPreprocess = priorParser?.preprocess;
		const preprocessedText =
			resolvedPriorParser &&
			priorParser &&
			typeof priorPreprocess === 'function' &&
			priorPreprocess !== preprocess
				? await withPriorParserOptions(
						options,
						resolvedPriorParser,
						(delegatedOptions): Promise<string> | string =>
							priorPreprocess.call(
								priorParser,
								text,
								delegatedOptions
							)
					)
				: text;

		return preprocessYAML(preprocessedText, options, preprocessState);
	};

	const parser: Parser = {
		...prettierParsers.yaml,
		astFormat: 'yaml',
		parse,
		preprocess,
	};
	const resolvePriorParser = createPriorParserResolver(
		prettierParsers.yaml.astFormat,
		parser
	);

	return markParserAsYAML(parser);
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
			'Quote all scalar mapping keys. Leaves YAML merge keys and explicitly tagged non-string keys unchanged. Removes unnecessary quotes when disabled.',
		type: 'boolean',
		default: false,
	},
	yamlQuoteKeysMatching: {
		category: 'Output',
		description:
			'Quote scalar mapping keys that match a specific pattern. Matches non-string keys based on their string representation. Leaves YAML merge keys and explicitly tagged non-string keys unchanged.',
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
			'Quote values that match a specific pattern. Matches non-string values based on their string representation. Leaves explicitly tagged non-string values unchanged. Takes precedence over `yamlBlockStyle`.',
		type: 'string',
	},
};

export const defaultOptions: Plugin['defaultOptions'] = {
	useTabs: false,
};

export type { PluginOptions };

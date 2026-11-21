import type { Parser, ParserOptions, Plugin } from 'prettier';
import type { PluginOptions } from './types/index.d.ts';
import { parsers as prettierParsers } from 'prettier/plugins/yaml';
import {
	callParserWithCompatibility,
	createPriorParserResolver,
	getParserDelegation,
	markParserAsOwn,
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
		const isDelegated =
			getParserDelegation(options, 'preprocess') !== undefined;
		const preprocessState = isDelegated
			? undefined
			: createPreprocessState(text, options);
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

		return isDelegated
			? preprocessedText
			: preprocessYAML(preprocessedText, options, preprocessState);
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

	return markParserAsOwn(parser);
}

export const parsers: Plugin['parsers'] = {
	yaml: createParser(),
};

export const options: Plugin['options'] = {
	yamlBlockStyle: {
		category: 'YAML',
		description:
			'Set the block style for multi-line strings outside flow collections.',
		type: 'choice',
		choices: [
			{
				description: 'Use folded scalars.',
				value: 'folded',
			},
			{
				description: 'Use literal scalars.',
				value: 'literal',
			},
		],
	},
	yamlCollectionStyle: {
		category: 'YAML',
		description: 'Choose how to format maps and sequences.',
		type: 'choice',
		choices: [
			{
				description: 'Use indentation and dashes.',
				value: 'block',
			},
			{
				description: 'Use braces and brackets.',
				value: 'flow',
			},
		],
	},
	yamlQuoteKeys: {
		category: 'YAML',
		description:
			'Quote all scalar mapping keys. Removes unnecessary quotes when disabled.',
		type: 'boolean',
		default: false,
	},
	yamlQuoteKeysMatching: {
		category: 'YAML',
		description:
			'Quote scalar mapping keys that match a regular expression.',
		type: 'string',
	},
	yamlQuoteValues: {
		category: 'YAML',
		description:
			'Quote all string values. Removes unnecessary quotes when disabled.',
		type: 'boolean',
		default: false,
	},
	yamlQuoteValuesMatching: {
		category: 'YAML',
		description: 'Quote values that match a regular expression.',
		type: 'string',
	},
};

export const defaultOptions: Plugin['defaultOptions'] = {
	useTabs: false,
};

export type { PluginOptions };

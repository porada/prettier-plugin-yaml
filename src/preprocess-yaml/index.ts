import type { ParserOptions } from 'prettier';
import type { PluginOptions } from '../types/index.d.ts';
import { parseAllDocuments, Scalar, visit } from 'yaml';

export default function preprocessYAML(
	text: string,
	{
		singleQuote,
		yamlBlockStyle,
		yamlCollectionStyle,
		yamlQuoteKeys,
		yamlQuoteKeysMatching,
		yamlQuoteValues,
		yamlQuoteValuesMatching,
	}: ParserOptions & PluginOptions
): string {
	const documents = parseAllDocuments(text);

	const { BLOCK_FOLDED, BLOCK_LITERAL, PLAIN, QUOTE_DOUBLE } = Scalar;

	const matchedKeyExpression =
		typeof yamlQuoteKeysMatching === 'string'
			? new RegExp(yamlQuoteKeysMatching)
			: undefined;

	const isMatchedKey = matchedKeyExpression
		? (key: unknown) => matchedKeyExpression.test(String(key))
		: () => false;

	const matchedValueExpression =
		typeof yamlQuoteValuesMatching === 'string'
			? new RegExp(yamlQuoteValuesMatching)
			: undefined;

	const isMatchedValue = matchedValueExpression
		? (value: unknown) => matchedValueExpression.test(String(value))
		: () => false;

	const scalarVisitor: Parameters<typeof visit>[1] = {
		Scalar(key, node) {
			const { type, value } = node;

			const isKey = key === 'key';
			const isQuoted = isKey
				? isMatchedKey(value)
				: isMatchedValue(value);

			if (typeof value !== 'string') {
				// Tag-specific stringifiers require the resolved runtime value
				if (node.tag) {
					return;
				}

				if (isQuoted || (isKey && yamlQuoteKeys)) {
					node.value = String(value);
					node.type = QUOTE_DOUBLE;
				}
				return;
			}

			if (isKey) {
				if (value === '<<' && !node.tag) {
					node.type = type === PLAIN ? PLAIN : QUOTE_DOUBLE;
				} else {
					node.type =
						isQuoted || yamlQuoteKeys ? QUOTE_DOUBLE : PLAIN;
				}
				return;
			}

			if (isQuoted) {
				node.type = QUOTE_DOUBLE;
				return;
			}

			if (type === BLOCK_FOLDED || type === BLOCK_LITERAL) {
				if (yamlQuoteValues) {
					node.type = QUOTE_DOUBLE;
				} else if (yamlCollectionStyle === 'flow') {
					node.type = PLAIN;
				}
				return;
			}

			if (yamlQuoteValues) {
				node.type = QUOTE_DOUBLE;
			} else if (
				yamlBlockStyle &&
				yamlCollectionStyle !== 'flow' &&
				value.includes('\n')
			) {
				node.type =
					yamlBlockStyle === 'folded' ? BLOCK_FOLDED : BLOCK_LITERAL;
			} else {
				node.type = PLAIN;
			}
		},
	};

	for (const document of documents) {
		visit(document, scalarVisitor);
	}

	if (documents.length === 0) {
		return text;
	}

	return documents
		.map((document) =>
			document.toString({
				...(yamlBlockStyle && { blockQuote: yamlBlockStyle }),
				...(yamlCollectionStyle && {
					collectionStyle: yamlCollectionStyle,
				}),
				lineWidth: 0,
				singleQuote,
			})
		)
		.join('');
}

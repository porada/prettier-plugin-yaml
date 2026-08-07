import type { ParserOptions } from 'prettier';
import type { PluginOptions, PreprocessState } from '../types/index.d.ts';
import { printers as prettierPrinters } from 'prettier/plugins/yaml';
import { parseAllDocuments, Scalar, visit } from 'yaml';

const YAML_PRAGMA_PREFIX = prettierPrinters.yaml.insertPragma?.('') ?? '';

export function createPreprocessState(
	text: string,
	options: ParserOptions
): PreprocessState {
	return {
		preserveSourcePositions: requiresSourcePositionPreservation(
			text,
			options
		),
	};
}

export default function preprocessYAML(
	text: string,
	options: ParserOptions & PluginOptions,
	state: PreprocessState = createPreprocessState(text, options)
): string {
	if (state.preserveSourcePositions) {
		return text;
	}

	const documents = parseAllDocuments(text);

	if (documents.some(hasPrettierIgnore)) {
		// Whole-document serialization cannot preserve ignored source ranges.
		return text;
	}

	const {
		singleQuote,
		yamlBlockStyle,
		yamlCollectionStyle,
		yamlQuoteKeys,
		yamlQuoteKeysMatching,
		yamlQuoteValues,
		yamlQuoteValuesMatching,
	} = options;

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

function requiresSourcePositionPreservation(
	text: string,
	options: ParserOptions
): boolean {
	const { cursorOffset, rangeEnd, rangeStart } = options;
	const sourceLength = getOriginalSourceLength(text, options);

	// Parser preprocessors cannot return source maps, so plugin-owned text
	// changes are unsafe while Prettier is tracking original source positions.
	return (
		(typeof cursorOffset === 'number' && cursorOffset >= 0) ||
		(typeof rangeStart === 'number' && rangeStart > 0) ||
		(typeof rangeEnd === 'number' && rangeEnd < sourceLength)
	);
}

function getOriginalSourceLength(
	text: string,
	{
		insertPragma,
		originalText,
		rangeEnd,
		rangeStart,
		requirePragma,
	}: ParserOptions
): number {
	if (typeof originalText === 'string') {
		return originalText.length;
	}

	const sourceWithoutPragma = text.slice(YAML_PRAGMA_PREFIX.length);
	const hasInsertedPragma =
		insertPragma &&
		!requirePragma &&
		rangeStart === 0 &&
		typeof rangeEnd === 'number' &&
		YAML_PRAGMA_PREFIX.length > 0 &&
		sourceWithoutPragma.length === rangeEnd &&
		prettierPrinters.yaml.insertPragma?.(sourceWithoutPragma) === text;

	return hasInsertedPragma ? rangeEnd : text.length;
}

function hasPrettierIgnore(
	document: ReturnType<typeof parseAllDocuments>[number]
): boolean {
	let hasIgnoreComment = hasPrettierIgnoreComment(document);

	visit(document, {
		Node(_key, node) {
			if (hasPrettierIgnoreComment(node)) {
				hasIgnoreComment = true;
				return visit.BREAK;
			}

			return undefined;
		},
	});

	return hasIgnoreComment;
}

function hasPrettierIgnoreComment({
	commentBefore,
}: {
	commentBefore?: string | null;
}): boolean {
	return commentBefore?.split('\n').at(-1)?.trim() === 'prettier-ignore';
}

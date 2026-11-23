import type { ParserOptions, Printer } from 'prettier';
import type { YAMLError } from 'yaml';
import type { PluginOptions, PreprocessState } from '../types/index.d.ts';
import { printers as prettierPrinters } from 'prettier/plugins/yaml';
import { parseAllDocuments, Scalar, visit } from 'yaml';
import { stringTag } from 'yaml/util';
import compareYAMLKeys from '../compare-yaml-keys/index.ts';

const YAML_PRAGMA_PREFIX = prettierPrinters.yaml.insertPragma?.('') ?? '';

/**
 * Captures the input for cursor offsets, formatting ranges, and diagnostics.
 */
export function createPreprocessState(
	text: string,
	options: ParserOptions
): PreprocessState {
	const hasInsertedPragma = detectInsertedPragma(text, options);

	return {
		mayHaveInsertedPragma: detectPossiblePragmaInsertion(
			options,
			hasInsertedPragma
		),
		preserveSourcePositions: requiresSourcePositionPreservation(
			text,
			options,
			hasInsertedPragma
		),
		sourceText: text,
	};
}

/**
 * Applies YAML formatting options to the document stream. Preserves the input
 * for cursor or partial-range formatting and `prettier-ignore` directives.
 */
export default function preprocessYAML(
	text: string,
	options: ParserOptions & PluginOptions,
	state: PreprocessState = createPreprocessState(text, options)
): string {
	if (state.preserveSourcePositions) {
		return text;
	}

	const documents = parseAllDocuments(text, {
		// Keep numeric source text instead of reserializing rounded values
		customTags: (tags) =>
			tags.map((tag) => {
				if (
					typeof tag === 'string' ||
					!tag.stringify ||
					![
						'tag:yaml.org,2002:float',
						'tag:yaml.org,2002:int',
					].includes(tag.tag)
				) {
					return tag;
				}

				const { stringify } = tag;

				return {
					...tag,
					stringify: (...args: Parameters<typeof stringify>) =>
						typeof args[0].value === 'string'
							? stringTag.stringify!(...args)
							: (args[0].source ?? stringify(...args)),
				};
			}),
		// Compare numeric keys for equality without rounding distinct values
		uniqueKeys: compareYAMLKeys,
	});

	if (documents.some(hasPrettierIgnore)) {
		return text;
	}

	const {
		singleQuote,
		yamlBlockStyle,
		yamlCollectionStyle,
		yamlQuoteKeys,
		yamlQuoteValues,
	} = options;

	const { BLOCK_FOLDED, BLOCK_LITERAL, PLAIN, QUOTE_DOUBLE } = Scalar;

	const matchedKeyExpression = compilePatternOption(
		options,
		'yamlQuoteKeysMatching'
	);

	const isMatchedKey = matchedKeyExpression
		? (key: unknown) => matchedKeyExpression.test(String(key))
		: () => false;

	const matchedValueExpression = compilePatternOption(
		options,
		'yamlQuoteValuesMatching'
	);

	const isMatchedValue = matchedValueExpression
		? (value: unknown) => matchedValueExpression.test(String(value))
		: () => false;

	for (const document of documents) {
		const [error] = document.errors;

		if (error) {
			throw createSyntaxError(error, text, state);
		}
	}

	const scalarVisitor: Parameters<typeof visit>[1] = {
		Scalar(key, node) {
			const { type, value } = node;
			const stringValue =
				typeof value === 'number' && node.source !== undefined
					? node.source
					: String(value);

			const isKey = key === 'key';
			const isQuoted = isKey
				? isMatchedKey(stringValue)
				: isMatchedValue(stringValue);

			if (typeof value !== 'string') {
				if (node.tag) {
					return;
				}

				if (isQuoted || (isKey && yamlQuoteKeys)) {
					node.value = stringValue;
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

/**
 * Compiles a quoting pattern and names the option if the expression is invalid.
 */
function compilePatternOption(
	options: PluginOptions,
	name: 'yamlQuoteKeysMatching' | 'yamlQuoteValuesMatching'
): RegExp | undefined {
	const pattern = options[name];

	if (typeof pattern !== 'string') {
		return undefined;
	}

	try {
		return new RegExp(pattern);
	} catch (error) {
		throw new SyntaxError(
			`[prettier-plugin-yaml] Failed to compile the regular expression for \`${name}\`:\n\n${(error as SyntaxError).message}`,
			{ cause: error }
		);
	}
}

/**
 * Checks whether a cursor offset or partial range requires unchanged input.
 */
function requiresSourcePositionPreservation(
	text: string,
	options: ParserOptions,
	hasInsertedPragma: boolean
): boolean {
	const { cursorOffset, originalText, rangeEnd, rangeStart } = options;
	const sourceLength =
		typeof originalText === 'string'
			? originalText.length
			: text.length - (hasInsertedPragma ? YAML_PRAGMA_PREFIX.length : 0);

	// Parser preprocessors can’t return source maps, so plugin-owned text
	// changes are unsafe while Prettier is tracking original source positions
	return (
		(typeof cursorOffset === 'number' && cursorOffset >= 0) ||
		(typeof rangeStart === 'number' && rangeStart > 0) ||
		(typeof rangeEnd === 'number' && rangeEnd < sourceLength)
	);
}

/**
 * Checks the text and range for the pragma added by Prettier’s YAML printer.
 */
function detectInsertedPragma(
	text: string,
	{
		insertPragma,
		originalText,
		rangeEnd,
		rangeStart,
		requirePragma,
	}: ParserOptions
): boolean {
	if (typeof originalText === 'string') {
		return false;
	}

	const sourceWithoutPragma = text.slice(YAML_PRAGMA_PREFIX.length);

	return (
		insertPragma &&
		!requirePragma &&
		rangeStart === 0 &&
		typeof rangeEnd === 'number' &&
		YAML_PRAGMA_PREFIX.length > 0 &&
		sourceWithoutPragma.length === rangeEnd &&
		prettierPrinters.yaml.insertPragma?.(sourceWithoutPragma) === text
	);
}

/**
 * Checks whether pragma insertion could have shifted source locations.
 */
function detectPossiblePragmaInsertion(
	{
		insertPragma,
		printer,
		requirePragma,
	}: ParserOptions & { printer?: Pick<Printer, 'insertPragma'> },
	hasInsertedPragma: boolean
): boolean {
	if (!insertPragma || requirePragma || (printer && !printer.insertPragma)) {
		return false;
	}

	// Only insertions by Prettier’s YAML printer can be ruled out from the text
	return (
		printer?.insertPragma !== prettierPrinters.yaml.insertPragma ||
		hasInsertedPragma
	);
}

/**
 * Preserves the YAML error as the cause and includes file coordinates when the
 * parser’s positions still apply to the source.
 */
function createSyntaxError(
	error: YAMLError,
	text: string,
	{ mayHaveInsertedPragma, sourceText }: PreprocessState
): SyntaxError {
	// Without a source map, positions in text that Prettier or prior
	// `preprocess` hooks may have changed can’t be mapped to the original file
	if (mayHaveInsertedPragma || text !== sourceText) {
		return new SyntaxError(
			`[prettier-plugin-yaml] Failed to parse YAML. Locations refer to the parser input:\n\n${error.message}`,
			{ cause: error }
		);
	}

	const syntaxError = new SyntaxError(error.message, { cause: error });

	if (error.linePos) {
		const [start, end] = error.linePos;

		Object.assign(syntaxError, {
			loc: {
				...(end && { end: { column: end.col, line: end.line } }),
				start: { column: start.col, line: start.line },
			},
		});
	}

	return syntaxError;
}

/**
 * Checks the document and its nodes for a `prettier-ignore` directive.
 */
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

/**
 * Checks whether the last line of a leading comment is `prettier-ignore`.
 */
function hasPrettierIgnoreComment({
	commentBefore,
}: {
	commentBefore?: string | null;
}): boolean {
	return commentBefore?.split('\n').at(-1)?.trim() === 'prettier-ignore';
}

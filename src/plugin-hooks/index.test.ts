import type { Parser, ParserOptions, Plugin } from 'prettier';
import { format } from 'prettier';
import { parsers as prettierParsers } from 'prettier/plugins/yaml';
import prettierPluginYAMLJS from 'prettier/plugins/yaml.js';
import { expect, test, vi } from 'vite-plus/test';
import * as pluginYAML from '../index.ts';
import { createPriorParserResolver, withPriorParserOptions } from './index.ts';

const TEST_YAML = 'foo: [bar]\n';

function getConcreteParser(plugin: typeof pluginYAML): Parser {
	const parser = plugin.parsers?.yaml;

	if (!parser || typeof parser === 'function') {
		throw new TypeError('Expected a concrete `yaml` parser.');
	}

	return parser;
}

test('returns `undefined` without a prior parser', async () => {
	const resolvePriorParser = createPriorParserResolver(
		prettierParsers.yaml.astFormat,
		getConcreteParser(pluginYAML)
	);
	const options = {
		plugins: [
			null,
			'missing-plugin',
			{ parsers: undefined },
			{ parsers: { yaml: undefined } },
		],
	} as unknown as ParserOptions;

	await expect(resolvePriorParser(options, 'parse')).resolves.toBeUndefined();
	await expect(resolvePriorParser(options, 'parse')).resolves.toBeUndefined();
});

test('sets and restores prior parser location functions', async () => {
	const currentParser = getConcreteParser(pluginYAML);
	const locEnd: Parser['locEnd'] = (node) =>
		prettierParsers.yaml.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		prettierParsers.yaml.locStart(node);
	const priorParser: Parser = {
		...prettierParsers.yaml,
		locEnd,
		locStart,
	};
	const plugins: ParserOptions['plugins'] = [];
	const options = {
		astFormat: currentParser.astFormat,
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		plugins: [pluginYAML],
	} as unknown as ParserOptions;
	const originalPlugins = options.plugins;

	await withPriorParserOptions(
		options,
		{ parser: priorParser, plugins },
		async (delegatedOptions) => {
			await Promise.resolve();
			expect(delegatedOptions.locEnd).toBe(locEnd);
			expect(delegatedOptions.locStart).toBe(locStart);
		}
	);

	expect(options.locEnd).toBe(currentParser.locEnd);
	expect(options.locStart).toBe(currentParser.locStart);
	expect(options.plugins).toBe(originalPlugins);
});

test('works with independently loaded plugin copies', async () => {
	vi.resetModules();

	const firstPlugin = await import('../index.ts');

	vi.resetModules();

	const secondPlugin = await import('../index.ts');
	const firstParser = getConcreteParser(firstPlugin);
	const secondParser = getConcreteParser(secondPlugin);

	expect(firstParser.parse).not.toBe(secondParser.parse);

	const singleCopyOutput = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [secondPlugin],
	});
	const duplicateCopyOutput = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [firstPlugin, secondPlugin],
	});

	expect(duplicateCopyOutput).toBe(singleCopyOutput);
});

test('works with Prettier’s CommonJS YAML parser', async () => {
	const expectedOutput = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
	});
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [prettierPluginYAMLJS, pluginYAML],
	});

	expect(output).toBe(expectedOutput);
});

test('rejects prior parsers with incompatible AST formats', async () => {
	const customPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				astFormat: 'custom-yaml',
			},
		},
	};

	await expect(
		format(TEST_YAML, {
			parser: 'yaml',
			plugins: [customPlugin, pluginYAML],
		})
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: prettier-plugin-yaml cannot compose with the \`yaml\` parser because it uses the \`custom-yaml\` AST format instead of \`yaml\`.]`
	);
});

test('skips an incompatible wrapper without a distinct hook', async () => {
	const currentParser = getConcreteParser(pluginYAML);
	const wrapperPlugin: Plugin = {
		parsers: {
			yaml: {
				...currentParser,
				astFormat: 'unused-yaml',
				preprocess: undefined,
			},
		},
	};

	const expectedOutput = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
	});
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [wrapperPlugin, pluginYAML],
	});

	expect(output).toBe(expectedOutput);
});

test('passes compatible options to prior parsers', async () => {
	let hasMatchingParser = false;
	let observedAstFormat: unknown;
	let observedPrintWidth: number | undefined;
	const observingPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse: (text, options) => {
					observedAstFormat = options.astFormat;
					observedPrintWidth = options.printWidth;
					hasMatchingParser =
						options.astFormat === 'yaml' &&
						options.plugins.includes(observingPlugin);
					return prettierParsers.yaml.parse(text, options);
				},
			},
		},
	};

	await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [observingPlugin, pluginYAML],
		printWidth: 80,
	});

	expect(hasMatchingParser).toBe(true);
	expect(observedAstFormat).toBe('yaml');
	expect(observedPrintWidth).toBe(80);
});

test('shares options between prior `preprocess` and `parse` hooks', async () => {
	let observedState = false;

	const statefulPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse: (text, options) => {
					observedState = options.yamlState === true;
					return prettierParsers.yaml.parse(text, options);
				},
				preprocess: (text, options) => {
					options.yamlState = true;
					return text;
				},
			},
		},
	};

	await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [statefulPlugin, pluginYAML],
	});

	expect(observedState).toBe(true);
});

test('applies YAML options after an expanding prior `preprocess` hook', async () => {
	const expandingPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				preprocess: () => `foo: [bar, baz]
qux: quux
`,
			},
		},
	};

	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [expandingPlugin, pluginYAML],
		yamlQuoteValues: true,
	});

	expect(output).toMatchInlineSnapshot(`
		"foo: ["bar", "baz"]
		qux: "quux"
		"
	`);
});

test('ignores plugins with an `undefined` parser map', async () => {
	const expectedOutput = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
	});
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [
			/* prettier-ignore */
			{ parsers: undefined },
			pluginYAML,
		],
	});

	expect(output).toBe(expectedOutput);
});

test('reuses a resolved lazy parser between hooks', async () => {
	let initializationCount = 0;
	let observedPreprocessed = false;
	const lazyPlugin = {
		parsers: {
			yaml: async () => {
				initializationCount += 1;
				let preprocessed = false;
				await Promise.resolve();

				return {
					...prettierParsers.yaml,
					parse: (text: string, options: ParserOptions) => {
						observedPreprocessed = preprocessed;
						return prettierParsers.yaml.parse(text, options);
					},
					preprocess: (text: string) => {
						preprocessed = true;
						return text;
					},
				};
			},
		},
	} as unknown as Plugin;

	await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [lazyPlugin, pluginYAML],
	});

	expect(initializationCount).toBe(1);
	expect(observedPreprocessed).toBe(true);
});

test('omits resolved lazy plugin copies from prior parser options', async () => {
	const parser = getConcreteParser(pluginYAML);
	let initializationCount = 0;
	let observedDuplicate = false;

	const lazyPlugin = {
		parsers: {
			yaml: async () => {
				initializationCount += 1;
				await Promise.resolve();
				return parser;
			},
		},
	} as unknown as Plugin;

	const observingPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse: (text, options) => {
					observedDuplicate = options.plugins.includes(lazyPlugin);
					return prettierParsers.yaml.parse(text, options);
				},
			},
		},
	};

	await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [observingPlugin, lazyPlugin, pluginYAML],
	});

	expect(initializationCount).toBe(1);
	expect(observedDuplicate).toBe(false);
});

test('does not initialize shadowed lazy parsers', async () => {
	let initializationCount = 0;

	const lazyPlugin = {
		parsers: {
			yaml: async () => {
				initializationCount += 1;
				await Promise.resolve();
				return prettierParsers.yaml;
			},
		},
	} as unknown as Plugin;

	const priorPlugin: Plugin = {
		parsers: {
			yaml: { ...prettierParsers.yaml },
		},
	};

	await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [lazyPlugin, priorPlugin, pluginYAML],
	});

	expect(initializationCount).toBe(0);
});

test('passes the compatibility options argument to prior parsers', async () => {
	let receivedDuplicatedOptions = false;
	const legacyPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse: (
					text: string,
					options: ParserOptions,
					compatibilityOptions?: ParserOptions
				) => {
					receivedDuplicatedOptions =
						compatibilityOptions === options;
					return prettierParsers.yaml.parse(
						text,
						compatibilityOptions ?? options
					);
				},
			},
		},
	};

	await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [legacyPlugin, pluginYAML],
	});

	expect(receivedDuplicatedOptions).toBe(true);
});

test('handles wrappers that copy the current parser hooks', async () => {
	const parser = getConcreteParser(pluginYAML);
	const wrapperPlugin: Plugin = {
		parsers: {
			yaml: { ...parser },
		},
	};

	const expectedOutput = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
	});
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [wrapperPlugin, pluginYAML],
	});

	expect(output).toBe(expectedOutput);
});

test('continues to prior parsers through copied wrappers', async () => {
	const parser = getConcreteParser(pluginYAML);
	const priorPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				preprocess: () => 'foo: qux\n',
			},
		},
	};
	const wrapperPlugin: Plugin = {
		parsers: {
			yaml: { ...parser },
		},
	};

	const expectedOutput = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [priorPlugin],
	});
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [priorPlugin, wrapperPlugin],
	});

	expect(output).toBe(expectedOutput);
});

test('handles wrappers that inherit from the current parser', async () => {
	const parser = getConcreteParser(pluginYAML);
	const wrapperParser = {
		preprocess: () => 'foo: baz\n',
	} as unknown as Parser;

	Object.setPrototypeOf(wrapperParser, parser);

	const wrapperPlugin: Plugin = {
		parsers: {
			yaml: wrapperParser,
		},
	};

	const expectedOutput = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [wrapperPlugin],
	});
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [wrapperPlugin, pluginYAML],
	});

	expect(output).toBe(expectedOutput);
});

test('handles wrappers that reuse the current `parse` function', async () => {
	const parser = getConcreteParser(pluginYAML);
	const wrapperPlugin: Plugin = {
		parsers: {
			yaml: {
				...parser,
				preprocess: () => 'foo: baz\n',
			},
		},
	};

	const expectedOutput = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [wrapperPlugin],
	});
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [wrapperPlugin, pluginYAML],
	});

	expect(output).toBe(expectedOutput);
});

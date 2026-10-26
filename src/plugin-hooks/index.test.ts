import type { Parser, ParserOptions, Plugin } from 'prettier';
import { format, formatWithCursor } from 'prettier';
import { parsers as prettierParsers } from 'prettier/plugins/yaml';
import prettierPluginYAMLJS from 'prettier/plugins/yaml.js';
import { expect, test, vi } from 'vite-plus/test';
import * as pluginYAML from '../index.ts';
import { createPriorParserResolver, withPriorParserOptions } from './index.ts';

const TEST_YAML = 'foo: [bar]\n';

function getDirectParser(plugin: typeof pluginYAML): Parser {
	const parser = plugin.parsers?.yaml;

	if (!parser || typeof parser === 'function') {
		throw new TypeError('Expected a direct `yaml` parser');
	}

	return parser;
}

test('returns `undefined` without a prior parser', async () => {
	const resolvePriorParser = createPriorParserResolver(
		prettierParsers.yaml.astFormat,
		getDirectParser(pluginYAML)
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

test('doesn’t resolve canonical parsers for aliased exports', async () => {
	const currentParser = getDirectParser(pluginYAML);
	const initializeCanonicalParser = vi.fn(async (): Promise<Parser> => {
		await Promise.resolve();
		return prettierParsers.yaml;
	});

	const canonicalPlugin = {
		parsers: { yaml: initializeCanonicalParser },
	} as unknown as Plugin;

	const aliasPlugin: Plugin = {
		parsers: { 'yaml-alias': currentParser },
	};

	const resolvePriorParser = createPriorParserResolver(
		prettierParsers.yaml.astFormat,
		currentParser
	);

	const options = {
		parser: 'yaml-alias',
		plugins: [canonicalPlugin, aliasPlugin],
	} as unknown as ParserOptions;

	await expect(resolvePriorParser(options, 'parse')).resolves.toBeUndefined();

	expect(initializeCanonicalParser).not.toHaveBeenCalled();
});

test.each(['after this plugin', 'alone', 'before this plugin'] as const)(
	'runs lazy copied hooks once when placed %s',
	async (placement) => {
		const parser = getDirectParser(pluginYAML);
		const parse = vi.fn(function (
			this: Parser,
			text: string,
			options: ParserOptions
		) {
			return parser.parse.call(this, text, options);
		});
		const preprocess = vi.fn(function (
			this: Parser,
			text: string,
			options: ParserOptions
		): Promise<string> | string {
			return parser.preprocess!.call(
				this,
				text.replace('[', '[baz, '),
				options
			);
		});

		const wrapperPlugin = {
			parsers: {
				yaml: async () => {
					await Promise.resolve();
					return { ...parser, parse, preprocess };
				},
			},
		} as unknown as Plugin;

		const expectedOutput = 'foo: [baz, bar]\n';

		const plugins = {
			'after this plugin': [pluginYAML, wrapperPlugin],
			'alone': [wrapperPlugin],
			'before this plugin': [wrapperPlugin, pluginYAML],
		}[placement];

		const output = await format(TEST_YAML, { parser: 'yaml', plugins });

		expect(parse).toHaveBeenCalledTimes(1);
		expect(preprocess).toHaveBeenCalledTimes(1);
		expect(output).toBe(expectedOutput);
	}
);

test.each([
	['a copied `parse` hook', 'parse', true],
	[
		'a copied `preprocess` hook through a wrapper that calls this plugin’s parser',
		'preprocess',
		false,
	],
	[
		'a copied `preprocess` hook through a wrapper that forwards its receiver',
		'preprocess',
		true,
	],
] as const)(
	'runs %s after plugin list replacement',
	async (_, hook, preserveReceiver) => {
		const parser = getDirectParser(pluginYAML);
		const priorHook = vi.fn((text: string, options: ParserOptions) =>
			parser[hook]!(text, options)
		);

		const innerPlugin: Plugin = {
			parsers: {
				yaml: {
					...parser,
					[hook]: priorHook,
				},
			},
		};

		const outerPlugin: Plugin = {
			parsers: {
				yaml: {
					...parser,
					preprocess(text, options): Promise<string> | string {
						options.plugins = [innerPlugin];

						if (hook === 'parse') {
							return text;
						}

						return preserveReceiver
							? parser.preprocess!.call(this, text, options)
							: parser.preprocess!(text, options);
					},
				},
			},
		};

		const output = await format(TEST_YAML, {
			parser: 'yaml',
			plugins: [innerPlugin, outerPlugin, pluginYAML],
		});

		expect(priorHook).toHaveBeenCalledTimes(1);
		expect(output).toBe(TEST_YAML);
	}
);

test('preserves the selected parser name between hooks', async () => {
	const currentParser = getDirectParser(pluginYAML);
	const priorParser: Parser = {
		...prettierParsers.yaml,
		preprocess: (text) => text,
	};

	const priorPlugin: Plugin = { parsers: { yaml: priorParser } };

	const resolvePriorParser = createPriorParserResolver(
		prettierParsers.yaml.astFormat,
		currentParser
	);

	const options = {
		parser: 'yaml',
		plugins: [priorPlugin, pluginYAML],
	} as unknown as ParserOptions;

	let result = await resolvePriorParser(options, 'preprocess');

	expect(result?.parser).toBe(priorParser);

	options.parser = 'yaml-alias';
	result = await resolvePriorParser(options, 'parse');

	expect(result?.parser).toBe(priorParser);
});

test('sets and restores prior parser location functions', async () => {
	const currentParser = getDirectParser(pluginYAML);

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
	const callback = vi.fn(async (delegatedOptions: ParserOptions) => {
		await Promise.resolve();
		expect(delegatedOptions.locEnd).toBe(locEnd);
		expect(delegatedOptions.locStart).toBe(locStart);
	});

	await withPriorParserOptions(
		options,
		{ lifecycleState: {}, parser: priorParser, plugins },
		callback
	);

	expect(callback).toHaveBeenCalledTimes(1);
	expect(options.locEnd).toBe(currentParser.locEnd);
	expect(options.locStart).toBe(currentParser.locStart);
	expect(options.plugins).toBe(originalPlugins);
});

test('doesn’t treat delegated options as entry changes for another hook', async () => {
	const currentParser = getDirectParser(pluginYAML);
	const priorParser: Parser = {
		...prettierParsers.yaml,
		locEnd: (node) => prettierParsers.yaml.locEnd(node),
		locStart: (node) => prettierParsers.yaml.locStart(node),
		preprocess: (text) => text,
	};

	const priorPlugin: Plugin = {
		parsers: {
			yaml: priorParser,
		},
	};

	const resolvePriorParser = createPriorParserResolver(
		prettierParsers.yaml.astFormat,
		currentParser
	);

	const options = {
		astFormat: currentParser.astFormat,
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		parser: 'yaml',
		plugins: [priorPlugin, pluginYAML],
	} as unknown as ParserOptions;

	const originalPlugins = options.plugins;
	const resolvedPriorParser = await resolvePriorParser(options, 'parse');

	expect(resolvedPriorParser?.parser).toBe(priorParser);

	const callback = vi.fn(async (delegatedOptions: ParserOptions) => {
		const resolvedPreprocess = await resolvePriorParser(
			delegatedOptions,
			'preprocess'
		);

		expect(resolvedPreprocess?.parser).toBe(priorParser);
		expect(resolvedPreprocess?.lifecycleState).toStrictEqual({});
	});

	await withPriorParserOptions(options, resolvedPriorParser!, callback);

	expect(callback).toHaveBeenCalledTimes(1);
	expect(options.locEnd).toBe(priorParser.locEnd);
	expect(options.locStart).toBe(priorParser.locStart);
	expect(options.plugins).toBe(originalPlugins);
	expect(resolvedPriorParser?.lifecycleState).toStrictEqual({});
});

test('preserves plugin lists reassigned by prior parsers', async () => {
	const currentParser = getDirectParser(pluginYAML);
	const reassignedPlugins: ParserOptions['plugins'] = [];

	const options = {
		astFormat: currentParser.astFormat,
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		plugins: [pluginYAML],
	} as unknown as ParserOptions;

	await withPriorParserOptions(
		options,
		{
			lifecycleState: {},
			parser: prettierParsers.yaml,
			plugins: [],
		},
		async (delegatedOptions) => {
			await Promise.resolve();
			delegatedOptions.plugins = reassignedPlugins;
		}
	);

	expect(options.plugins).toBe(reassignedPlugins);
});

test('works with independently loaded plugin copies', async () => {
	vi.resetModules();

	const firstPlugin = await import('../index.ts');

	vi.resetModules();

	const secondPlugin = await import('../index.ts');
	const firstParser = getDirectParser(firstPlugin);
	const secondParser = getDirectParser(secondPlugin);

	expect(firstParser.parse).not.toBe(secondParser.parse);

	const expectedOutput = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [secondPlugin],
	});
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [firstPlugin, secondPlugin],
	});

	expect(output).toBe(expectedOutput);
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
		`[TypeError: [prettier-plugin-yaml] Unsupported AST format for the \`yaml\` parser. Expected \`yaml\`, received \`custom-yaml\`]`
	);
});

test('rejects incompatible wrappers before skipping shared hooks', async () => {
	const currentParser = getDirectParser(pluginYAML);
	const wrapperPlugin: Plugin = {
		parsers: {
			yaml: {
				...currentParser,
				astFormat: 'custom-yaml',
				preprocess: undefined,
			},
		},
	};

	await expect(
		format(TEST_YAML, {
			parser: 'yaml',
			plugins: [wrapperPlugin, pluginYAML],
		})
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-yaml] Unsupported AST format for the \`yaml\` parser. Expected \`yaml\`, received \`custom-yaml\`]`
	);
});

test('passes compatible options to prior parsers', async () => {
	let observedAstFormat: unknown;
	let observedPlugins: ParserOptions['plugins'] | undefined;
	let observedPrintWidth: number | undefined;

	const observingPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse: (text, options) => {
					observedAstFormat = options.astFormat;
					observedPlugins = options.plugins;
					observedPrintWidth = options.printWidth;
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

	expect(observedAstFormat).toBe('yaml');
	expect(observedPlugins).toContain(observingPlugin);
	expect(observedPrintWidth).toBe(80);
});

test('shares options between prior `preprocess` and `parse` hooks', async () => {
	let observedLocEnd: Parser['locEnd'] | undefined;
	let observedLocStart: Parser['locStart'] | undefined;
	let observedState: unknown;

	const locEnd: Parser['locEnd'] = (node) =>
		prettierParsers.yaml.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		prettierParsers.yaml.locStart(node);

	const statefulPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse: (text, options) => {
					observedLocEnd = options.locEnd;
					observedLocStart = options.locStart;
					observedState = options.yamlState;
					return prettierParsers.yaml.parse(text, options);
				},
				preprocess: async (text, options) => {
					await Promise.resolve();
					options.locEnd = locEnd;
					options.locStart = locStart;
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

	expect(observedLocEnd).toBe(locEnd);
	expect(observedLocStart).toBe(locStart);
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

test('preserves parser lifecycle state after plugin list reassignment', async () => {
	let observedLocEnd: Parser['locEnd'] | undefined;
	let observedLocStart: Parser['locStart'] | undefined;
	let observedPreprocessed: boolean | undefined;

	const locEnd: Parser['locEnd'] = (node) =>
		prettierParsers.yaml.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		prettierParsers.yaml.locStart(node);

	const initializeParser = vi.fn(async () => {
		let preprocessed = false;
		await Promise.resolve();

		return {
			...prettierParsers.yaml,
			parse: (text: string, options: ParserOptions) => {
				observedLocEnd = options.locEnd;
				observedLocStart = options.locStart;
				observedPreprocessed = preprocessed;
				return prettierParsers.yaml.parse(text, options);
			},
			preprocess: (text: string, options: ParserOptions) => {
				preprocessed = true;
				options.locEnd = locEnd;
				options.locStart = locStart;
				options.plugins = [...options.plugins];
				return text;
			},
		};
	});

	const lazyPlugin = {
		parsers: {
			yaml: initializeParser,
		},
	} as unknown as Plugin;

	await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [lazyPlugin, pluginYAML],
	});

	expect(initializeParser).toHaveBeenCalledTimes(1);
	expect(observedPreprocessed).toBe(true);
	expect(observedLocEnd).toBe(locEnd);
	expect(observedLocStart).toBe(locStart);
});

test('omits resolved lazy plugin copies from prior parser options', async () => {
	const parser = getDirectParser(pluginYAML);

	let observedPlugins: ParserOptions['plugins'] | undefined;

	const initializeParser = vi.fn(async () => {
		await Promise.resolve();
		return parser;
	});

	const lazyPlugin = {
		parsers: {
			yaml: initializeParser,
		},
	} as unknown as Plugin;

	const observingPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse: (text, options) => {
					observedPlugins = options.plugins;
					return prettierParsers.yaml.parse(text, options);
				},
			},
		},
	};

	await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [observingPlugin, lazyPlugin, pluginYAML],
	});

	expect(initializeParser).toHaveBeenCalledTimes(1);
	expect(observedPlugins).not.toContain(lazyPlugin);
});

test('doesn’t initialize shadowed lazy parsers', async () => {
	const initializeParser = vi.fn(async () => {
		await Promise.resolve();
		return prettierParsers.yaml;
	});

	const lazyPlugin = {
		parsers: {
			yaml: initializeParser,
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

	expect(initializeParser).not.toHaveBeenCalled();
});

test('passes the compatibility options argument to prior parsers', async () => {
	const parse = vi.fn(
		(
			text: string,
			options: ParserOptions,
			compatibilityOptions?: ParserOptions
		) => prettierParsers.yaml.parse(text, compatibilityOptions ?? options)
	);

	const legacyPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse,
			},
		},
	};

	await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [legacyPlugin, pluginYAML],
	});

	expect(parse).toHaveBeenCalledTimes(1);

	const [, options, compatibilityOptions] = parse.mock.calls[0]!;

	expect(compatibilityOptions).toBe(options);
});

test('handles wrappers that copy the current parser hooks', async () => {
	const parser = getDirectParser(pluginYAML);
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
	const parser = getDirectParser(pluginYAML);

	const priorPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				preprocess: () => 'foo: baz\n',
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

test('avoids recursion through wrappers that inherit from the current parser', async () => {
	const parser = getDirectParser(pluginYAML);
	let parseCallCount = 0;

	const wrapperParser = {
		parse: (text: string, options: ParserOptions) => {
			parseCallCount += 1;

			if (parseCallCount > 1) {
				throw new Error();
			}

			return parser.parse(text, options);
		},
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
	expect(parseCallCount).toBe(1);
});

test.each([
	['parse', 'alone'],
	['parse', 'before an independent plugin instance'],
	['parse', 'before this plugin'],
	['preprocess', 'alone'],
	['preprocess', 'before an independent plugin instance'],
	['preprocess', 'before this plugin'],
] as const)(
	'runs a delegating `%s` wrapper once when placed %s with a prior parser',
	async (hook, placement) => {
		vi.resetModules();

		const firstPlugin = await import('../index.ts');
		const parser = getDirectParser(firstPlugin);

		if (placement === 'before an independent plugin instance') {
			vi.resetModules();
		}

		const secondPlugin = await import('../index.ts');

		let wrapperCallCount = 0;

		const priorParse = vi.fn((text: string, options: ParserOptions) => {
			expect(options.yamlState).toBe(true);
			return prettierParsers.yaml.parse(text, options);
		});
		const priorPreprocess = vi.fn((text: string) =>
			text.replace('[', '[baz, ')
		);
		const initializePriorParser = vi.fn(async () => {
			await Promise.resolve();
			return {
				...prettierParsers.yaml,
				parse: priorParse,
				preprocess: priorPreprocess,
			};
		});

		const priorPlugin = {
			parsers: {
				yaml: initializePriorParser,
			},
		} as unknown as Plugin;

		const wrapperPlugin: Plugin = {
			parsers: {
				yaml: {
					...parser,
					[hook]: async (text: string, options: ParserOptions) => {
						wrapperCallCount += 1;

						if (wrapperCallCount > 1) {
							throw new Error();
						}

						await Promise.resolve();
						options.yamlState = true;
						return parser[hook]!(
							hook === 'preprocess'
								? text.replace('[', '[qux, ')
								: text,
							options
						);
					},
				},
			},
		};

		const expectedOutput = await format(
			hook === 'parse' ? 'foo: [baz, bar]\n' : 'foo: [baz, qux, bar]\n',
			{ parser: 'yaml', plugins: [secondPlugin] }
		);

		const plugins =
			placement === 'alone'
				? [priorPlugin, wrapperPlugin]
				: [priorPlugin, wrapperPlugin, secondPlugin];

		const output = await format(TEST_YAML, { parser: 'yaml', plugins });

		expect(initializePriorParser).toHaveBeenCalledTimes(1);
		expect(priorParse).toHaveBeenCalledTimes(1);
		expect(priorPreprocess).toHaveBeenCalledTimes(1);
		expect(wrapperCallCount).toBe(1);
		expect(output).toBe(expectedOutput);
	}
);

test.each(['alone', 'before this plugin'] as const)(
	'runs wrapped hooks once when placed %s without a prior parser',
	async (placement) => {
		const parser = getDirectParser(pluginYAML);
		let parseCallCount = 0;
		let preprocessCallCount = 0;

		const wrapperPlugin: Plugin = {
			parsers: {
				yaml: {
					...parser,
					parse: (text, options) => {
						parseCallCount += 1;

						if (parseCallCount > 1) {
							throw new Error();
						}

						return parser.parse(text, options);
					},
					preprocess: async (text, options) => {
						preprocessCallCount += 1;

						if (preprocessCallCount > 1) {
							throw new Error();
						}

						const output = await parser.preprocess!(
							text.replace('bar', 'baz'),
							options
						);

						return output;
					},
				},
			},
		};

		const expectedOutput = await format('foo: [baz]\n', {
			parser: 'yaml',
			plugins: [pluginYAML],
		});

		const output = await format(TEST_YAML, {
			parser: 'yaml',
			plugins:
				placement === 'alone'
					? [wrapperPlugin]
					: [wrapperPlugin, pluginYAML],
		});

		expect(parseCallCount).toBe(1);
		expect(preprocessCallCount).toBe(1);
		expect(output).toBe(expectedOutput);
	}
);

test('applies YAML options only after delegated preprocessing', async () => {
	const parser = getDirectParser(pluginYAML);
	let preprocessCallCount = 0;

	const wrapperPlugin: Plugin = {
		parsers: {
			yaml: {
				...parser,
				preprocess: async (text, options) => {
					preprocessCallCount += 1;

					if (preprocessCallCount > 1) {
						throw new Error();
					}

					const output = await parser.preprocess!(text, options);

					expect(output).toBe(TEST_YAML);

					return output.replace('[', '[baz, ');
				},
			},
		},
	};

	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [wrapperPlugin, pluginYAML],
		yamlQuoteValues: true,
	});

	expect(preprocessCallCount).toBe(1);
	expect(output).toBe('foo: ["baz", "bar"]\n');
});

test('preserves removed plugins across prior parser hooks', async () => {
	const removedParse = vi.fn(prettierParsers.yaml.parse);
	const removedPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse: removedParse,
			},
		},
	};

	let replacementPlugins: ParserOptions['plugins'] | undefined;

	const priorParse = vi.fn((text: string, options: ParserOptions) => {
		expect(options.plugins).toBe(replacementPlugins);
		expect(options.plugins).not.toContain(removedPlugin);
		return prettierParsers.yaml.parse(text, options);
	});
	const initializePriorParser = vi.fn(async () => {
		await Promise.resolve();
		return {
			...prettierParsers.yaml,
			parse: priorParse,
			preprocess: (text: string, options: ParserOptions) => {
				replacementPlugins = options.plugins.filter(
					(plugin) => plugin !== removedPlugin
				);

				options.plugins = replacementPlugins;
				return text;
			},
		};
	});

	const priorPlugin = {
		parsers: {
			yaml: initializePriorParser,
		},
	} as unknown as Plugin;

	const expectedOutput = await format(TEST_YAML, { parser: 'yaml' });

	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [removedPlugin, priorPlugin, pluginYAML],
	});

	expect(initializePriorParser).toHaveBeenCalledTimes(1);
	expect(priorParse).toHaveBeenCalledTimes(1);
	expect(removedParse).not.toHaveBeenCalled();
	expect(output).toBe(expectedOutput);
});

test('retains prior parser location functions for cursor formatting', async () => {
	const locEnd = vi.fn(prettierParsers.yaml.locEnd);
	const locStart = vi.fn(prettierParsers.yaml.locStart);

	const priorPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				locEnd,
				locStart,
			},
		},
	};

	const expectedResult = await formatWithCursor(TEST_YAML, {
		cursorOffset: TEST_YAML.indexOf('bar'),
		parser: 'yaml',
		plugins: [priorPlugin],
	});

	locEnd.mockClear();
	locStart.mockClear();

	const result = await formatWithCursor(TEST_YAML, {
		cursorOffset: TEST_YAML.indexOf('bar'),
		parser: 'yaml',
		plugins: [priorPlugin, pluginYAML],
	});

	expect(result).toStrictEqual(expectedResult);
	expect(locEnd).toHaveBeenCalled();
	expect(locStart).toHaveBeenCalled();
});

test.each(['after this plugin', 'alone', 'before this plugin'] as const)(
	'uses location fields from a copied wrapper placed %s only when Prettier selects it',
	async (placement) => {
		const parser = getDirectParser(pluginYAML);

		const locEnd = vi.fn(prettierParsers.yaml.locEnd);
		const locStart = vi.fn(prettierParsers.yaml.locStart);
		const parse = vi.fn(parser.parse);
		const priorLocEnd = vi.fn(prettierParsers.yaml.locEnd);
		const priorLocStart = vi.fn(prettierParsers.yaml.locStart);

		const priorPlugin: Plugin = {
			parsers: {
				yaml: {
					...prettierParsers.yaml,
					locEnd: priorLocEnd,
					locStart: priorLocStart,
				},
			},
		};

		const wrapperPlugin: Plugin = {
			parsers: {
				yaml: {
					...parser,
					locEnd,
					locStart,
					parse,
				},
			},
		};

		const options = {
			cursorOffset: TEST_YAML.indexOf('bar'),
			parser: 'yaml',
		};

		const expectedResult = await formatWithCursor(TEST_YAML, {
			...options,
			plugins: [pluginYAML],
		});

		const plugins = {
			'after this plugin': [priorPlugin, pluginYAML, wrapperPlugin],
			'alone': [priorPlugin, wrapperPlugin],
			'before this plugin': [priorPlugin, wrapperPlugin, pluginYAML],
		}[placement];

		const isSelectedParser = placement !== 'before this plugin';

		const result = await formatWithCursor(TEST_YAML, {
			...options,
			plugins,
		});

		expect(result).toStrictEqual(expectedResult);
		expect(parse).toHaveBeenCalledTimes(1);
		expect(isSelectedParser ? locEnd : priorLocEnd).toHaveBeenCalled();
		expect(isSelectedParser ? locStart : priorLocStart).toHaveBeenCalled();
		expect(isSelectedParser ? priorLocEnd : locEnd).not.toHaveBeenCalled();
		expect(
			isSelectedParser ? priorLocStart : locStart
		).not.toHaveBeenCalled();
	}
);

test.each([
	['parser fields', 'after this plugin'],
	['parser fields', 'alone'],
	['the `preprocess` hook', 'after this plugin'],
	['the `preprocess` hook', 'alone'],
] as const)(
	'preserves wrapper location overrides from %s when placed %s',
	async (source, placement) => {
		const parser = getDirectParser(pluginYAML);
		const locEnd = vi.fn(prettierParsers.yaml.locEnd);
		const locStart = vi.fn(prettierParsers.yaml.locStart);

		const priorPlugin: Plugin = {
			parsers: {
				yaml: prettierParsers.yaml,
			},
		};

		const copiedParser: Parser = { ...parser };

		if (source === 'parser fields') {
			copiedParser.locEnd = locEnd;
			copiedParser.locStart = locStart;
		} else {
			copiedParser.preprocess = (text, options) => {
				options.locEnd = locEnd;
				options.locStart = locStart;
				return text;
			};
		}

		const copiedPlugin: Plugin = {
			parsers: {
				yaml: copiedParser,
			},
		};

		const expectedResult = await formatWithCursor(TEST_YAML, {
			cursorOffset: TEST_YAML.indexOf('bar'),
			parser: 'yaml',
		});

		const plugins = {
			'after this plugin': [priorPlugin, pluginYAML, copiedPlugin],
			'alone': [priorPlugin, copiedPlugin],
		}[placement];

		const result = await formatWithCursor(TEST_YAML, {
			cursorOffset: TEST_YAML.indexOf('bar'),
			parser: 'yaml',
			plugins,
		});

		expect(result).toStrictEqual(expectedResult);
		expect(locEnd).toHaveBeenCalled();
		expect(locStart).toHaveBeenCalled();
	}
);

test.each([
	['parse', 'after this plugin'],
	['parse', 'alone'],
	['parse', 'before this plugin'],
	['preprocess', 'after this plugin'],
	['preprocess', 'alone'],
	['preprocess', 'before this plugin'],
] as const)(
	'passes location overrides from `%s` wrappers to the prior parser when placed %s',
	async (hook, placement) => {
		const parser = getDirectParser(pluginYAML);
		const locEnd: Parser['locEnd'] = (node) =>
			prettierParsers.yaml.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			prettierParsers.yaml.locStart(node);

		let observedLocEnd: Parser['locEnd'] | undefined;
		let observedLocStart: Parser['locStart'] | undefined;
		let observedOptions: ParserOptions | undefined;
		let wrapperCallCount = 0;

		const priorHook = vi.fn((text: string, options: ParserOptions) => {
			observedLocEnd = options.locEnd;
			observedLocStart = options.locStart;
			observedOptions = options;

			return hook === 'parse'
				? prettierParsers.yaml.parse(text, options)
				: text;
		});

		const priorPlugin: Plugin = {
			parsers: {
				yaml: {
					...prettierParsers.yaml,
					[hook]: priorHook,
				},
			},
		};

		const wrapperPlugin: Plugin = {
			parsers: {
				yaml: {
					...parser,
					[hook]: async (text: string, options: ParserOptions) => {
						wrapperCallCount += 1;

						if (wrapperCallCount > 1) {
							throw new Error();
						}

						await Promise.resolve();
						options.locEnd = locEnd;
						options.locStart = locStart;

						return parser[hook]!(text, options);
					},
				},
			},
		};

		const plugins = {
			'after this plugin': [priorPlugin, pluginYAML, wrapperPlugin],
			'alone': [priorPlugin, wrapperPlugin],
			'before this plugin': [priorPlugin, wrapperPlugin, pluginYAML],
		}[placement];

		const expectedOutput = await format(TEST_YAML, {
			parser: 'yaml',
			plugins: [pluginYAML],
		});

		const output = await format(TEST_YAML, {
			parser: 'yaml',
			plugins,
		});

		expect(observedLocEnd).toBe(locEnd);
		expect(observedLocStart).toBe(locStart);
		expect(priorHook).toHaveBeenCalledTimes(1);
		expect(wrapperCallCount).toBe(1);
		expect(output).toBe(expectedOutput);
		expect(observedOptions?.locEnd).toBe(locEnd);
		expect(observedOptions?.locStart).toBe(locStart);
	}
);

test.each([
	['parse', 'after this plugin'],
	['parse', 'alone'],
	['parse', 'before this plugin'],
	['preprocess', 'after this plugin'],
	['preprocess', 'alone'],
	['preprocess', 'before this plugin'],
] as const)(
	'passes plugin list overrides from `%s` wrappers to the prior parser when placed %s',
	async (hook, placement) => {
		const parser = getDirectParser(pluginYAML);

		let observedOptions: ParserOptions | undefined;
		let observedPlugins: ParserOptions['plugins'] | undefined;
		let wrapperCallCount = 0;

		const priorHook = vi.fn((text: string, options: ParserOptions) => {
			observedOptions = options;
			observedPlugins = options.plugins;

			return hook === 'parse'
				? prettierParsers.yaml.parse(text, options)
				: text;
		});

		const priorPlugin: Plugin = {
			parsers: {
				yaml: {
					...prettierParsers.yaml,
					[hook]: priorHook,
				},
			},
		};

		const reassignedPlugins: ParserOptions['plugins'] = [priorPlugin];

		const wrapperPlugin: Plugin = {
			parsers: {
				yaml: {
					...parser,
					[hook]: async (text: string, options: ParserOptions) => {
						wrapperCallCount += 1;

						if (wrapperCallCount > 1) {
							throw new Error();
						}

						await Promise.resolve();
						options.plugins = reassignedPlugins;

						return parser[hook]!(text, options);
					},
				},
			},
		};

		const plugins = {
			'after this plugin': [priorPlugin, pluginYAML, wrapperPlugin],
			'alone': [priorPlugin, wrapperPlugin],
			'before this plugin': [priorPlugin, wrapperPlugin, pluginYAML],
		}[placement];

		const expectedOutput = await format(TEST_YAML, {
			parser: 'yaml',
			plugins: [pluginYAML],
		});

		const output = await format(TEST_YAML, {
			parser: 'yaml',
			plugins,
		});

		expect(observedPlugins).toBe(reassignedPlugins);
		expect(priorHook).toHaveBeenCalledTimes(1);
		expect(wrapperCallCount).toBe(1);
		expect(output).toBe(expectedOutput);
		expect(observedOptions?.plugins).toBe(reassignedPlugins);
	}
);

test('tracks entry option resets without prior preprocessing', async () => {
	const parser = getDirectParser(pluginYAML);
	const priorPlugin: Plugin = {
		parsers: {
			yaml: prettierParsers.yaml,
		},
	};

	const resolvePriorParser = createPriorParserResolver(
		prettierParsers.yaml.astFormat,
		parser
	);

	const locEnd: Parser['locEnd'] = (node) =>
		prettierParsers.yaml.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		prettierParsers.yaml.locStart(node);

	const options = {
		locEnd,
		locStart,
		parser: 'yaml',
		plugins: [priorPlugin, pluginYAML],
	} as unknown as ParserOptions;

	await expect(
		resolvePriorParser(options, 'preprocess')
	).resolves.toBeUndefined();

	options.locEnd = parser.locEnd;
	options.locStart = parser.locStart;

	const resolvedPriorParser = await resolvePriorParser(options, 'parse');

	expect(resolvedPriorParser?.lifecycleState).toStrictEqual({
		locEnd: parser.locEnd,
		locStart: parser.locStart,
	});
});

test('preserves entry option resets after rejected parsing', async () => {
	const parser = getDirectParser(pluginYAML);
	const locEnd: Parser['locEnd'] = (node) =>
		prettierParsers.yaml.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		prettierParsers.yaml.locStart(node);

	let parseCallCount = 0;
	let wrapperCallCount = 0;

	const error = new Error();
	const priorParser: Parser = {
		...prettierParsers.yaml,
		locEnd: (node) => prettierParsers.yaml.locEnd(node),
		locStart: (node) => prettierParsers.yaml.locStart(node),
		parse: (text, options) => {
			parseCallCount += 1;

			expect(options.locEnd).toBe(
				parseCallCount === 1 ? priorParser.locEnd : parser.locEnd
			);
			expect(options.locStart).toBe(
				parseCallCount === 1 ? priorParser.locStart : parser.locStart
			);
			expect(options.plugins).toContain(priorPlugin);

			if (parseCallCount === 1) {
				options.plugins = [];
				options.locEnd = locEnd;
				options.locStart = locStart;
				throw error;
			}

			return prettierParsers.yaml.parse(text, options);
		},
	};

	const priorPlugin: Plugin = {
		parsers: {
			yaml: priorParser,
		},
	};

	const wrapperPlugin: Plugin = {
		parsers: {
			yaml: {
				...parser,
				parse: async (text, options) => {
					wrapperCallCount += 1;

					if (wrapperCallCount > 1) {
						throw new Error();
					}

					const originalPlugins = options.plugins;

					await expect(
						Promise.resolve(parser.parse(text, options))
					).rejects.toBe(error);

					expect(options.locEnd).toBe(locEnd);
					expect(options.locStart).toBe(locStart);
					expect(options.plugins).toStrictEqual([]);

					options.locEnd = parser.locEnd;
					options.locStart = parser.locStart;
					options.plugins = originalPlugins;
					return parser.parse(text, options);
				},
			},
		},
	};

	const expectedOutput = await format(TEST_YAML, { parser: 'yaml' });

	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [priorPlugin, pluginYAML, wrapperPlugin],
	});

	expect(parseCallCount).toBe(2);
	expect(wrapperCallCount).toBe(1);
	expect(output).toBe(expectedOutput);
});

test('preserves entry option resets after resolved parsing', async () => {
	const parser = getDirectParser(pluginYAML);

	let parseCallCount = 0;
	let wrapperCallCount = 0;

	const priorParser: Parser = {
		...prettierParsers.yaml,
		locEnd: (node) => prettierParsers.yaml.locEnd(node),
		locStart: (node) => prettierParsers.yaml.locStart(node),
		parse: (text, options) => {
			parseCallCount += 1;

			expect(options.locEnd).toBe(
				parseCallCount === 1 ? priorParser.locEnd : parser.locEnd
			);
			expect(options.locStart).toBe(
				parseCallCount === 1 ? priorParser.locStart : parser.locStart
			);
			expect(options.plugins).toContain(priorPlugin);

			if (parseCallCount === 1) {
				options.plugins = [];
			}

			return prettierParsers.yaml.parse(text, options);
		},
	};

	const priorPlugin: Plugin = {
		parsers: {
			yaml: priorParser,
		},
	};

	const wrapperPlugin: Plugin = {
		parsers: {
			yaml: {
				...parser,
				parse: async (text, options) => {
					wrapperCallCount += 1;

					if (wrapperCallCount > 1) {
						throw new Error();
					}

					const originalPlugins = options.plugins;

					await expect(
						Promise.resolve(parser.parse(text, options))
					).resolves.toBeDefined();

					expect(options.locEnd).toBe(priorParser.locEnd);
					expect(options.locStart).toBe(priorParser.locStart);
					expect(options.plugins).toStrictEqual([]);

					options.locEnd = parser.locEnd;
					options.locStart = parser.locStart;
					options.plugins = originalPlugins;
					return parser.parse(text, options);
				},
			},
		},
	};

	const expectedOutput = await format(TEST_YAML, { parser: 'yaml' });

	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [priorPlugin, pluginYAML, wrapperPlugin],
	});

	expect(parseCallCount).toBe(2);
	expect(wrapperCallCount).toBe(1);
	expect(output).toBe(expectedOutput);
});

test('restores parser locations when a wrapper rejects after delegated parsing', async () => {
	const error = new Error();
	const parser = getDirectParser(pluginYAML);

	const locEnd: Parser['locEnd'] = (node) =>
		prettierParsers.yaml.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		prettierParsers.yaml.locStart(node);

	let observedOptions: ParserOptions | undefined;

	const priorPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				locEnd,
				locStart,
			},
		},
	};

	const wrapperPlugin: Plugin = {
		parsers: {
			yaml: {
				...parser,
				parse: async (text, options) => {
					observedOptions = options;

					await parser.parse(text, options);

					throw error;
				},
			},
		},
	};

	await expect(
		format(TEST_YAML, {
			parser: 'yaml',
			plugins: [priorPlugin, wrapperPlugin, pluginYAML],
		})
	).rejects.toBe(error);

	expect(observedOptions?.locEnd).toBe(parser.locEnd);
	expect(observedOptions?.locStart).toBe(parser.locStart);
});

test('preserves location overrides after a wrapper delegates parsing', async () => {
	const parser = getDirectParser(pluginYAML);

	const locEnd: Parser['locEnd'] = (node) =>
		prettierParsers.yaml.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		prettierParsers.yaml.locStart(node);

	let observedOptions: ParserOptions | undefined;

	const priorPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse: (text, options) => {
					options.locEnd = locEnd;
					options.locStart = locStart;
					return prettierParsers.yaml.parse(text, options);
				},
			},
		},
	};

	const wrapperPlugin: Plugin = {
		parsers: {
			yaml: {
				...parser,
				parse: async (text, options) => {
					observedOptions = options;

					const ast = await parser.parse(text, options);

					options.locEnd = parser.locEnd;
					options.locStart = parser.locStart;
					return ast;
				},
			},
		},
	};

	const expectedOutput = await format(TEST_YAML, { parser: 'yaml' });

	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [priorPlugin, wrapperPlugin, pluginYAML],
	});

	expect(output).toBe(expectedOutput);
	expect(observedOptions?.locEnd).toBe(parser.locEnd);
	expect(observedOptions?.locStart).toBe(parser.locStart);
});

test('handles wrappers that reuse the current `parse` function', async () => {
	const parser = getDirectParser(pluginYAML);
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

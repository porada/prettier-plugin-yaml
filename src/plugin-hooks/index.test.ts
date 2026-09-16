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

test.each([
	['after this plugin', 'after'],
	['alone', 'alone'],
	['before this plugin', 'before'],
] as const)('runs lazy copied hooks once %s', async (_, placement) => {
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
		after: [pluginYAML, wrapperPlugin],
		alone: [wrapperPlugin],
		before: [wrapperPlugin, pluginYAML],
	}[placement];

	const output = await format(TEST_YAML, { parser: 'yaml', plugins });

	expect(parse).toHaveBeenCalledTimes(1);
	expect(preprocess).toHaveBeenCalledTimes(1);
	expect(output).toBe(expectedOutput);
});

test.each(['parse', 'preprocess'] as const)(
	'runs a copied `%s` hook after plugin list replacement with this plugin last',
	async (hook) => {
		for (const preserveReceiver of [false, true]) {
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

	await expect(
		resolvePriorParser(options, 'preprocess')
	).resolves.toMatchObject({ parser: priorParser });

	options.parser = 'yaml-alias';

	await expect(resolvePriorParser(options, 'parse')).resolves.toMatchObject({
		parser: priorParser,
	});
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

	await withPriorParserOptions(
		options,
		{ lifecycleState: {}, parser: priorParser, plugins },
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

	await withPriorParserOptions(
		options,
		resolvedPriorParser!,
		async (delegatedOptions) => {
			const resolvedPreprocess = await resolvePriorParser(
				delegatedOptions,
				'preprocess'
			);

			expect(resolvedPreprocess?.parser).toBe(priorParser);
			expect(resolvedPreprocess?.lifecycleState).toStrictEqual({});
		}
	);

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

	const locEnd: Parser['locEnd'] = (node) =>
		prettierParsers.yaml.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		prettierParsers.yaml.locStart(node);

	const statefulPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse: (text, options) => {
					observedState =
						options.yamlState === true &&
						options.locEnd === locEnd &&
						options.locStart === locStart;
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
	let initializationCount = 0;
	let observedLifecycleState = false;

	const locEnd: Parser['locEnd'] = (node) =>
		prettierParsers.yaml.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		prettierParsers.yaml.locStart(node);

	const lazyPlugin = {
		parsers: {
			yaml: async () => {
				initializationCount += 1;
				let preprocessed = false;
				await Promise.resolve();

				return {
					...prettierParsers.yaml,
					parse: (text: string, options: ParserOptions) => {
						observedLifecycleState =
							preprocessed &&
							options.locEnd === locEnd &&
							options.locStart === locStart;
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
			},
		},
	} as unknown as Plugin;

	await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [lazyPlugin, pluginYAML],
	});

	expect(initializationCount).toBe(1);
	expect(observedLifecycleState).toBe(true);
});

test('omits resolved lazy plugin copies from prior parser options', async () => {
	const parser = getDirectParser(pluginYAML);

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

test('doesn’t initialize shadowed lazy parsers', async () => {
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

test.each(['parse', 'preprocess'] as const)(
	'runs a delegating `%s` wrapper once with a prior parser',
	async (hook) => {
		for (const placement of [
			'alone',
			'before another instance',
			'before this plugin',
		] as const) {
			vi.resetModules();

			const firstPlugin = await import('../index.ts');
			const parser = getDirectParser(firstPlugin);

			if (placement === 'before another instance') {
				vi.resetModules();
			}

			const secondPlugin = await import('../index.ts');

			let initializationCount = 0;
			let parseCallCount = 0;
			let preprocessCallCount = 0;
			let wrapperCallCount = 0;

			const priorPlugin = {
				parsers: {
					yaml: async () => {
						initializationCount += 1;
						await Promise.resolve();
						return {
							...prettierParsers.yaml,
							parse: (text: string, options: ParserOptions) => {
								parseCallCount += 1;
								expect(options.yamlState).toBe(true);
								return prettierParsers.yaml.parse(
									text,
									options
								);
							},
							preprocess: (text: string) => {
								preprocessCallCount += 1;
								return text.replace('[', '[baz, ');
							},
						};
					},
				},
			} as unknown as Plugin;

			const wrapperPlugin: Plugin = {
				parsers: {
					yaml: {
						...parser,
						[hook]: async (
							text: string,
							options: ParserOptions
						) => {
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
				hook === 'parse'
					? 'foo: [baz, bar]\n'
					: 'foo: [baz, qux, bar]\n',
				{ parser: 'yaml', plugins: [secondPlugin] }
			);

			const plugins =
				placement === 'alone'
					? [priorPlugin, wrapperPlugin]
					: [priorPlugin, wrapperPlugin, secondPlugin];

			const output = await format(TEST_YAML, { parser: 'yaml', plugins });

			expect(initializationCount).toBe(1);
			expect(parseCallCount).toBe(1);
			expect(preprocessCallCount).toBe(1);
			expect(wrapperCallCount).toBe(1);
			expect(output).toBe(expectedOutput);
		}
	}
);

test.each(['alone', 'before this plugin'] as const)(
	'runs wrapped hooks once %s without a prior parser',
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

	let initializationCount = 0;
	let replacementPlugins: ParserOptions['plugins'] | undefined;

	const priorPlugin = {
		parsers: {
			yaml: async () => {
				initializationCount += 1;
				await Promise.resolve();
				return {
					...prettierParsers.yaml,
					parse: (text: string, options: ParserOptions) => {
						expect(options.plugins).toBe(replacementPlugins);
						expect(options.plugins).not.toContain(removedPlugin);
						return prettierParsers.yaml.parse(text, options);
					},
					preprocess: (text: string, options: ParserOptions) => {
						replacementPlugins = options.plugins.filter(
							(plugin) => plugin !== removedPlugin
						);

						options.plugins = replacementPlugins;
						return text;
					},
				};
			},
		},
	} as unknown as Plugin;

	const expectedOutput = await format(TEST_YAML, { parser: 'yaml' });

	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [removedPlugin, priorPlugin, pluginYAML],
	});

	expect(initializationCount).toBe(1);
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

	const expectedOutput = await formatWithCursor(TEST_YAML, {
		cursorOffset: TEST_YAML.indexOf('bar'),
		parser: 'yaml',
		plugins: [priorPlugin],
	});

	locEnd.mockClear();
	locStart.mockClear();

	const output = await formatWithCursor(TEST_YAML, {
		cursorOffset: TEST_YAML.indexOf('bar'),
		parser: 'yaml',
		plugins: [priorPlugin, pluginYAML],
	});

	expect(output).toStrictEqual(expectedOutput);
	expect(locEnd).toHaveBeenCalled();
	expect(locStart).toHaveBeenCalled();
});

test('uses copied wrapper location fields only when selected by Prettier', async () => {
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

	const expectedOutput = await formatWithCursor(TEST_YAML, {
		...options,
		plugins: [pluginYAML],
	});

	for (const placement of ['after', 'alone', 'before'] as const) {
		const plugins = {
			after: [priorPlugin, pluginYAML, wrapperPlugin],
			alone: [priorPlugin, wrapperPlugin],
			before: [priorPlugin, wrapperPlugin, pluginYAML],
		}[placement];

		const isSelectedParser = placement !== 'before';

		locEnd.mockClear();
		locStart.mockClear();
		parse.mockClear();
		priorLocEnd.mockClear();
		priorLocStart.mockClear();

		const output = await formatWithCursor(TEST_YAML, {
			...options,
			plugins,
		});

		expect(output).toStrictEqual(expectedOutput);
		expect(parse).toHaveBeenCalledTimes(1);
		expect(isSelectedParser ? locEnd : priorLocEnd).toHaveBeenCalled();
		expect(isSelectedParser ? locStart : priorLocStart).toHaveBeenCalled();
		expect(isSelectedParser ? priorLocEnd : locEnd).not.toHaveBeenCalled();
		expect(
			isSelectedParser ? priorLocStart : locStart
		).not.toHaveBeenCalled();
	}
});

test.each(['parser fields', 'preprocess'] as const)(
	'retains selected copied parser locations from %s',
	async (source) => {
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

		const expectedOutput = await formatWithCursor(TEST_YAML, {
			cursorOffset: TEST_YAML.indexOf('bar'),
			parser: 'yaml',
		});

		for (const plugins of [
			[priorPlugin, copiedPlugin],
			[priorPlugin, pluginYAML, copiedPlugin],
		]) {
			locEnd.mockClear();
			locStart.mockClear();

			const output = await formatWithCursor(TEST_YAML, {
				cursorOffset: TEST_YAML.indexOf('bar'),
				parser: 'yaml',
				plugins,
			});

			expect(output).toStrictEqual(expectedOutput);
			expect(locEnd).toHaveBeenCalled();
			expect(locStart).toHaveBeenCalled();
		}
	}
);

test.each(['parse', 'preprocess'] as const)(
	'preserves option changes before a wrapped `%s` delegates',
	async (hook) => {
		const parser = getDirectParser(pluginYAML);
		const addedPlugin: Plugin = {};
		const removedPlugin: Plugin = {};

		const locEnd: Parser['locEnd'] = (node) =>
			prettierParsers.yaml.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			prettierParsers.yaml.locStart(node);

		const priorParser: Parser = {
			...prettierParsers.yaml,
			locEnd: (node) => prettierParsers.yaml.locEnd(node),
			locStart: (node) => prettierParsers.yaml.locStart(node),
		};

		const expectedOutput = await format(TEST_YAML, { parser: 'yaml' });

		for (const override of ['locations', 'plugins']) {
			for (const placement of ['after', 'alone', 'before']) {
				let observedOptions: ParserOptions | undefined;
				let wrapperCallCount = 0;

				const priorHook = vi.fn(
					(text: string, options: ParserOptions) => {
						observedOptions = options;

						expect(options.locEnd).toBe(
							override === 'locations'
								? locEnd
								: priorParser.locEnd
						);
						expect(options.locStart).toBe(
							override === 'locations'
								? locStart
								: priorParser.locStart
						);
						expect(options.plugins.includes(addedPlugin)).toBe(
							override === 'plugins'
						);
						expect(options.plugins.includes(removedPlugin)).toBe(
							override === 'locations'
						);

						return hook === 'parse'
							? priorParser.parse(text, options)
							: text;
					}
				);

				const priorPlugin: Plugin = {
					parsers: {
						yaml: {
							...priorParser,
							[hook]: priorHook,
						},
					},
				};

				const wrapperPlugin: Plugin = {
					parsers: {
						yaml: {
							...parser,
							[hook]: async (
								text: string,
								options: ParserOptions
							) => {
								wrapperCallCount += 1;

								if (wrapperCallCount > 1) {
									throw new Error();
								}

								if (override === 'locations') {
									options.locEnd = locEnd;
									options.locStart = locStart;
								} else {
									options.plugins = [
										...options.plugins.filter(
											(plugin) => plugin !== removedPlugin
										),
										addedPlugin,
									];
								}

								await Promise.resolve();
								return parser[hook]!(text, options);
							},
						},
					},
				};

				const plugins = [removedPlugin, priorPlugin];

				if (placement === 'after') {
					plugins.push(pluginYAML, wrapperPlugin);
				} else if (placement === 'before') {
					plugins.push(wrapperPlugin, pluginYAML);
				} else {
					plugins.push(wrapperPlugin);
				}

				const output = await format(TEST_YAML, {
					parser: 'yaml',
					plugins,
				});

				expect(priorHook).toHaveBeenCalledTimes(1);
				expect(wrapperCallCount).toBe(1);
				expect(output).toBe(expectedOutput);
				expect(observedOptions?.locEnd).toBe(
					override === 'locations' ? locEnd : priorParser.locEnd
				);
				expect(observedOptions?.locStart).toBe(
					override === 'locations' ? locStart : priorParser.locStart
				);
			}
		}
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

	const options = {
		locEnd: (node) => prettierParsers.yaml.locEnd(node),
		locStart: (node) => prettierParsers.yaml.locStart(node),
		parser: 'yaml',
		plugins: [priorPlugin, pluginYAML],
	} as ParserOptions;

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

test.each(['rejected', 'resolved'] as const)(
	'preserves entry option resets after %s parsing',
	async (outcome) => {
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
					parseCallCount === 1
						? priorParser.locStart
						: parser.locStart
				);
				expect(options.plugins).toContain(priorPlugin);

				if (parseCallCount === 1) {
					options.plugins = [];

					if (outcome === 'rejected') {
						options.locEnd = locEnd;
						options.locStart = locStart;
						throw error;
					}
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
						const result = parser.parse(text, options);

						await expect(
							Promise.resolve(result).then(
								() => undefined,
								(caughtError: unknown) => caughtError
							)
						).resolves.toBe(
							outcome === 'rejected' ? error : undefined
						);

						expect(options.locEnd).toBe(
							outcome === 'rejected' ? locEnd : priorParser.locEnd
						);
						expect(options.locStart).toBe(
							outcome === 'rejected'
								? locStart
								: priorParser.locStart
						);
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
	}
);

test('restores locations when a wrapper rejects after delegated parsing', async () => {
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

					throw new Error();
				},
			},
		},
	};

	await expect(
		format(TEST_YAML, {
			parser: 'yaml',
			plugins: [priorPlugin, wrapperPlugin, pluginYAML],
		})
	).rejects.toThrow(Error);

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

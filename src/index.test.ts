import type { Parser, Plugin } from 'prettier';
import type { PluginOptions } from './index.ts';
import { format, formatWithCursor } from 'prettier';
import * as prettierPluginYAML from 'prettier/plugins/yaml';
import { format as standaloneFormat } from 'prettier/standalone';
import { expect, expectTypeOf, test } from 'vite-plus/test';
import { YAMLParseError } from 'yaml';
import * as pluginYAML from './index.ts';

test('exposes correct public API', () => {
	expectTypeOf(pluginYAML).toExtend<Plugin>();

	expect(pluginYAML).toHaveProperty('defaultOptions');
	expect(pluginYAML).toHaveProperty('options');
	expect(pluginYAML).toHaveProperty('parsers');
	expect(pluginYAML.parsers).toHaveProperty('yaml');

	expectTypeOf<PluginOptions>().toBeObject();
});

const TEST_YAML = `
version: 2

description: >-
  You can use Dependabot to keep the packages you use updated to the latest versions.

updates:
  - package-ecosystem: github-actions
    directory: '/'
    schedule:
      { interval: 'weekly', time: '12:00' }

  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: "daily"
    versioning-strategy: "increase"
    cooldown:
      default-days: 1
    ignore:
      - dependency-name: |-
          @standard-config/prettier

values:
  0: true
  1: false
  2: null
`;

const RANGE_YAML = 'first: [foo,bar]\nsecond: [baz,qux]\n';

async function getSyntaxError(promise: Promise<unknown>): Promise<SyntaxError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof SyntaxError) {
			return error;
		}

		throw error;
	}

	throw new TypeError('Expected a `SyntaxError`');
}

test('formats YAML', async () => {
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
	};

	const output = await format(TEST_YAML, options);

	expect(output).toMatchSnapshot();
	await expect(format(output, options)).resolves.toBe(output);
});

test('preserves numeric precision with YAML formatting options', async () => {
	const input = `foo:
  - 9007199254740993
  - 0.1234567890123456789
bar: baz
`;

	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		yamlCollectionStyle: 'flow' as const,
		yamlQuoteValues: true,
	};

	const expectedOutput =
		'{ foo: [9007199254740993, 0.1234567890123456789], bar: "baz" }\n';

	const output = await format(input, options);

	expect(output).toBe(expectedOutput);
	await expect(format(output, options)).resolves.toBe(output);
});

test('preserves numeric precision in distinct mapping keys', async () => {
	const input = `9007199254740992: foo
9007199254740993: bar
0.1234567890123456788: baz
0.1234567890123456789: qux
`;
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		yamlQuoteValues: true,
	};

	const expectedOutput = `9007199254740992: "foo"
9007199254740993: "bar"
0.1234567890123456788: "baz"
0.1234567890123456789: "qux"
`;

	const output = await format(input, options);

	expect(output).toBe(expectedOutput);
	await expect(format(output, options)).resolves.toBe(output);
});

test('rejects equivalent numeric mapping keys', async () => {
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		yamlCollectionStyle: 'flow' as const,
	};

	await expect(format('0: foo\n-0: bar\n', options)).rejects.toThrow(
		'Map keys must be unique'
	);
	await expect(format('1: foo\n0o1: bar\n', options)).rejects.toThrow(
		'Map keys must be unique'
	);
	await expect(format('1: foo\n0x1: bar\n', options)).rejects.toThrow(
		'Map keys must be unique'
	);
	await expect(format('1.0: foo\n1e0: bar\n', options)).rejects.toThrow(
		'Map keys must be unique'
	);
});

test('rejects equivalent numeric mapping keys in YAML 1.1 documents', async () => {
	const input = `%YAML 1.1
---
9007199254740993:00: foo
540431955284459580: bar
`;

	await expect(
		format(input, {
			parser: 'yaml',
			plugins: [pluginYAML],
		})
	).rejects.toThrow('Map keys must be unique');
});

test('reports YAML errors with source locations', async () => {
	const input = 'foo: [bar,baz\nqux: quux\n';

	const error = await getSyntaxError(
		format(input, {
			parser: 'yaml',
			plugins: [pluginYAML],
		})
	);

	expect(error.message).toMatchInlineSnapshot(`
		"Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1:

		foo: [bar,baz
		qux: quux
		^
		"
	`);
	expect(error).toHaveProperty('loc', {
		end: { column: 2, line: 2 },
		start: { column: 1, line: 2 },
	});
	expect(error.cause).toBeInstanceOf(YAMLParseError);
	expect(error.cause).toHaveProperty('message', error.message);
});

test('reports YAML errors after `insertPragma` without source locations', async () => {
	const error = await getSyntaxError(
		format('foo: bar\nfoo: baz\n', {
			insertPragma: true,
			parser: 'yaml',
			plugins: [pluginYAML],
		})
	);

	expect(error.message).toMatchInlineSnapshot(`
		"[prettier-plugin-yaml] Failed to parse YAML. Locations refer to the parser input:

		Map keys must be unique at line 4, column 1:

		foo: bar
		foo: baz
		^
		"
	`);
	expect(error).not.toHaveProperty('loc');
	expect(error.cause).toBeInstanceOf(YAMLParseError);
});

test('reports YAML errors with source locations after an existing pragma', async () => {
	const error = await getSyntaxError(
		format('# @prettier\nfoo: bar\nfoo: baz\n', {
			insertPragma: true,
			parser: 'yaml',
			plugins: [pluginYAML],
		})
	);

	expect(error.cause).toHaveProperty('message', error.message);
	expect(error).toHaveProperty('loc', {
		end: { column: 2, line: 3 },
		start: { column: 1, line: 3 },
	});
});

test('reports YAML errors without source locations after an ambiguous existing pragma', async () => {
	const pragma = '# @format\n\n';
	const input = `${pragma}foo: bar\nfoo: baz\n`;

	const error = await getSyntaxError(
		format(input, {
			insertPragma: true,
			parser: 'yaml',
			plugins: [pluginYAML],
			rangeEnd: input.length - pragma.length,
		})
	);

	expect(error.message).toMatchInlineSnapshot(`
		"[prettier-plugin-yaml] Failed to parse YAML. Locations refer to the parser input:

		Map keys must be unique at line 4, column 1:

		foo: bar
		foo: baz
		^
		"
	`);
	expect(error).not.toHaveProperty('loc');
});

test('reports YAML errors without source locations after a custom `insertPragma`', async () => {
	const testPlugin: Plugin = {
		printers: {
			yaml: {
				...prettierPluginYAML.printers.yaml,
				insertPragma: (text) =>
					text.replace('# generator\n', '# @format\n#\n'),
			},
		},
	};

	const error = await getSyntaxError(
		format('# generator\nfoo: bar\nfoo: baz\n', {
			insertPragma: true,
			parser: 'yaml',
			plugins: [testPlugin, pluginYAML],
		})
	);

	expect(error.message).toMatchInlineSnapshot(`
		"[prettier-plugin-yaml] Failed to parse YAML. Locations refer to the parser input:

		Map keys must be unique at line 4, column 1:

		foo: bar
		foo: baz
		^
		"
	`);
	expect(error).not.toHaveProperty('loc');
	expect(error.cause).toBeInstanceOf(YAMLParseError);
});

test.each([
	{
		input: '# @prettier\n\nfoo: bar\nfoo: baz\n',
		insertPragma: (text: string) =>
			text.replace('# generator\n', '# @format\n#\n'),
		line: 4,
		requirePragma: true,
	},
	{
		input: 'foo: bar\nfoo: baz\n',
		insertPragma: undefined,
		line: 2,
		requirePragma: false,
	},
])(
	'reports YAML errors with source locations when Prettier skips pragma insertion',
	async ({ input, insertPragma, line, requirePragma }) => {
		const testPlugin: Plugin = {
			printers: {
				yaml: {
					...prettierPluginYAML.printers.yaml,
					insertPragma,
				},
			},
		};

		const error = await getSyntaxError(
			format(input, {
				insertPragma: true,
				parser: 'yaml',
				plugins: [testPlugin, pluginYAML],
				requirePragma,
			})
		);

		expect(error.cause).toHaveProperty('message', error.message);
		expect(error).toHaveProperty('loc', {
			end: { column: 2, line },
			start: { column: 1, line },
		});
	}
);

test('formats YAML with parser warnings', async () => {
	const input = 'foo: !bar [baz,qux]\n';
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		yamlQuoteValues: true,
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"foo: !bar ["baz", "qux"]
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test.each(['!!float', '!!int'])(
	'preserves strings with an explicit `%s` tag',
	async (tag) => {
		const input = `foo: ${tag} "bar: baz"
qux: ${tag} "# Comment"
`;
		const options = {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
		};

		const expectedOutput = await format(input, { parser: 'yaml' });
		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
	}
);

test('respects `bracketSpacing`', async () => {
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		bracketSpacing: false,
	};

	const output = await format(TEST_YAML, options);

	expect(output).toMatchSnapshot();
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `checkIgnorePragma`', async () => {
	const input = '# @noformat\nfoo: [bar,baz]\n';
	const options = {
		checkIgnorePragma: true,
		parser: 'yaml' as const,
		plugins: [pluginYAML],
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"# @noformat
		foo: [bar,baz]
		"
	`);
});

test('respects `cursorOffset`', async () => {
	const input = `foo:
  - bar
  - baz
`;
	const cursorOffset = input.indexOf('baz') + 1;

	const expectedResult = await formatWithCursor(input, {
		cursorOffset,
		parser: 'yaml',
	});
	const result = await formatWithCursor(input, {
		cursorOffset,
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlCollectionStyle: 'flow',
	});

	expect(result).toStrictEqual(expectedResult);
});

test('respects `embeddedLanguageFormatting`', async () => {
	const input = `\`\`\`yaml
foo: [bar,baz]
\`\`\`
`;

	const options = {
		auto: {
			embeddedLanguageFormatting: 'auto' as const,
			parser: 'markdown' as const,
			plugins: [pluginYAML],
			yamlQuoteValues: true,
		},
		off: {
			embeddedLanguageFormatting: 'off' as const,
			parser: 'markdown' as const,
			plugins: [pluginYAML],
			yamlQuoteValues: true,
		},
	};

	const outputs = {
		auto: await format(input, options.auto),
		off: await format(input, options.off),
	};

	expect(outputs).toMatchInlineSnapshot(`
		{
		  "auto": "\`\`\`yaml
		foo: ["bar", "baz"]
		\`\`\`
		",
		  "off": "\`\`\`yaml
		foo: [bar,baz]
		\`\`\`
		",
		}
	`);
	await expect(format(outputs.auto, options.auto)).resolves.toBe(
		outputs.auto
	);
});

test('respects `endOfLine`', async () => {
	const options = {
		endOfLine: 'crlf' as const,
		parser: 'yaml' as const,
		plugins: [pluginYAML],
	};

	const output = await format('foo: bar\nbaz: qux\n', options);

	expect(output).toBe('foo: bar\r\nbaz: qux\r\n');
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `insertPragma`', async () => {
	const input = 'foo: [bar,baz]\n';
	const options = {
		insertPragma: true,
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		yamlQuoteValues: true,
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"# @format

		foo: ["bar", "baz"]
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `prettier-ignore` comments', async () => {
	const input = `foo:
  # prettier-ignore
  ignored: [foo,bar]
formatted: [baz,qux]
`;
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		yamlQuoteValues: true,
	};

	const expectedOutput = await format(input, { parser: 'yaml' });
	const output = await format(input, options);

	expect(output).toBe(expectedOutput);
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `printWidth`', async () => {
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		printWidth: 12,
	};

	const output = await format('foo: [bar, baz, qux, quux]\n', options);

	expect(output).toMatchInlineSnapshot(`
		"foo:
		  [
		    bar,
		    baz,
		    qux,
		    quux,
		  ]
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `proseWrap`', async () => {
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		proseWrap: 'always' as const,
	};

	const output = await format(TEST_YAML, options);

	expect(output).toMatchSnapshot();
	await expect(format(output, options)).resolves.toBe(output);
});

test.each([
	[0, RANGE_YAML.indexOf('second')],
	[RANGE_YAML.indexOf('second'), RANGE_YAML.length],
])('respects `rangeStart` and `rangeEnd`', async (rangeStart, rangeEnd) => {
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		rangeEnd,
		rangeStart,
		yamlQuoteValues: true,
	};

	const expectedOutput = await format(RANGE_YAML, {
		parser: 'yaml',
		rangeEnd,
		rangeStart,
	});
	const output = await format(RANGE_YAML, options);

	expect(output).toBe(expectedOutput);
});

test('respects `requirePragma`', async () => {
	const input = '# @format\nfoo: [bar,baz]\n';
	const unformattedInput = 'foo: [bar,baz]\n';
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		requirePragma: true,
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"# @format
		foo: [bar, baz]
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
	await expect(format(unformattedInput, options)).resolves.toBe(
		unformattedInput
	);
});

test('respects `singleQuote`', async () => {
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		singleQuote: true,
	};

	const output = await format('foo: "bar: baz"\n', options);

	expect(output).toMatchInlineSnapshot(`
		"foo: 'bar: baz'
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `tabWidth`', async () => {
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		tabWidth: 4,
	};

	const output = await format(TEST_YAML, options);

	expect(output).toMatchSnapshot();
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `trailingComma`', async () => {
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
		printWidth: 20,
		trailingComma: 'none' as const,
	};

	const output = await format(
		'{ foo: [bar, baz], qux: { quux: corge } }\n',
		options
	);

	expect(output).toMatchInlineSnapshot(`
		"{
		  foo: [bar, baz],
		  qux:
		    { quux: corge }
		}
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `useTabs`', async () => {
	const output = await format('foo:\n  bar:\n    baz: qux\n', {
		parser: 'yaml',
		plugins: [pluginYAML],
		useTabs: true,
	});

	expect(output).toMatchInlineSnapshot(`
		"foo:
		  bar:
		    baz: qux
		"
	`);
});

test('supports `yamlBlockStyle`', async () => {
	const options = {
		folded: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlBlockStyle: 'folded' as const,
		},
		literal: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlBlockStyle: 'literal' as const,
		},
	};

	const outputs = {
		folded: await format(TEST_YAML, options.folded),
		literal: await format(TEST_YAML, options.literal),
	};

	expect(outputs).toMatchSnapshot();
	await expect(format(outputs.folded, options.folded)).resolves.toBe(
		outputs.folded
	);
	await expect(format(outputs.literal, options.literal)).resolves.toBe(
		outputs.literal
	);
});

test('supports `yamlCollectionStyle`', async () => {
	const options = {
		block: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlCollectionStyle: 'block' as const,
		},
		flow: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			bracketSpacing: true,
			yamlCollectionStyle: 'flow' as const,
		},
		flowWithoutBracketSpacing: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			bracketSpacing: false,
			yamlCollectionStyle: 'flow' as const,
		},
	};

	const outputs = {
		block: await format(TEST_YAML, options.block),
		flow: await format(TEST_YAML, options.flow),
		flowWithoutBracketSpacing: await format(
			TEST_YAML,
			options.flowWithoutBracketSpacing
		),
	};

	expect(outputs).toMatchSnapshot();
	await expect(format(outputs.block, options.block)).resolves.toBe(
		outputs.block
	);
	await expect(format(outputs.flow, options.flow)).resolves.toBe(
		outputs.flow
	);
	await expect(
		format(
			outputs.flowWithoutBracketSpacing,
			options.flowWithoutBracketSpacing
		)
	).resolves.toBe(outputs.flowWithoutBracketSpacing);
});

test('supports `yamlQuoteKeys`', async () => {
	const options = {
		default: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlQuoteKeys: true,
		},
		singleQuote: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			singleQuote: true,
			yamlQuoteKeys: true,
		},
		yamlCollectionStyle: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlCollectionStyle: 'flow' as const,
			yamlQuoteKeys: true,
		},
	};

	const outputs = {
		default: await format(TEST_YAML, options.default),
		singleQuote: await format(TEST_YAML, options.singleQuote),
		yamlCollectionStyle: await format(
			TEST_YAML,
			options.yamlCollectionStyle
		),
	};

	expect(outputs).toMatchSnapshot();
	await expect(format(outputs.default, options.default)).resolves.toBe(
		outputs.default
	);
	await expect(
		format(outputs.singleQuote, options.singleQuote)
	).resolves.toBe(outputs.singleQuote);
	await expect(
		format(outputs.yamlCollectionStyle, options.yamlCollectionStyle)
	).resolves.toBe(outputs.yamlCollectionStyle);
});

test('supports `yamlQuoteKeysMatching`', async () => {
	const options = {
		hyphen: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlQuoteKeysMatching: '-',
		},
		yamlQuoteKeys: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlQuoteKeys: true,
			yamlQuoteKeysMatching: '^\\d+$',
		},
	};

	const outputs = {
		hyphen: await format(TEST_YAML, options.hyphen),
		yamlQuoteKeys: await format(TEST_YAML, options.yamlQuoteKeys),
	};

	expect(outputs).toMatchSnapshot();
	await expect(format(outputs.hyphen, options.hyphen)).resolves.toBe(
		outputs.hyphen
	);
	await expect(
		format(outputs.yamlQuoteKeys, options.yamlQuoteKeys)
	).resolves.toBe(outputs.yamlQuoteKeys);
});

test('supports `yamlQuoteValues`', async () => {
	const options = {
		default: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlQuoteValues: true,
		},
		singleQuote: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			singleQuote: true,
			yamlQuoteValues: true,
		},
		singleQuoteAndYamlQuoteKeys: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			singleQuote: true,
			yamlQuoteKeys: true,
			yamlQuoteValues: true,
		},
		yamlCollectionStyle: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlCollectionStyle: 'flow' as const,
			yamlQuoteValues: true,
		},
	};

	const outputs = {
		default: await format(TEST_YAML, options.default),
		singleQuote: await format(TEST_YAML, options.singleQuote),
		singleQuoteAndYamlQuoteKeys: await format(
			TEST_YAML,
			options.singleQuoteAndYamlQuoteKeys
		),
		yamlCollectionStyle: await format(
			TEST_YAML,
			options.yamlCollectionStyle
		),
	};

	expect(outputs).toMatchSnapshot();
	await expect(format(outputs.default, options.default)).resolves.toBe(
		outputs.default
	);
	await expect(
		format(outputs.singleQuote, options.singleQuote)
	).resolves.toBe(outputs.singleQuote);
	await expect(
		format(
			outputs.singleQuoteAndYamlQuoteKeys,
			options.singleQuoteAndYamlQuoteKeys
		)
	).resolves.toBe(outputs.singleQuoteAndYamlQuoteKeys);
	await expect(
		format(outputs.yamlCollectionStyle, options.yamlCollectionStyle)
	).resolves.toBe(outputs.yamlCollectionStyle);
});

test('supports `yamlQuoteValuesMatching`', async () => {
	const options = {
		numeric: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlQuoteValuesMatching: '^\\d+(:\\d+)?$',
		},
		whitespaceOrSlash: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlQuoteValuesMatching: '[\\s/]',
		},
		yamlQuoteValues: {
			parser: 'yaml' as const,
			plugins: [pluginYAML],
			yamlQuoteValues: true,
			yamlQuoteValuesMatching: '^(\\d+|true|false|null)$',
		},
	};

	const outputs = {
		numeric: await format(TEST_YAML, options.numeric),
		whitespaceOrSlash: await format(TEST_YAML, options.whitespaceOrSlash),
		yamlQuoteValues: await format(TEST_YAML, options.yamlQuoteValues),
	};

	expect(outputs).toMatchSnapshot();
	await expect(format(outputs.numeric, options.numeric)).resolves.toBe(
		outputs.numeric
	);
	await expect(
		format(outputs.whitespaceOrSlash, options.whitespaceOrSlash)
	).resolves.toBe(outputs.whitespaceOrSlash);
	await expect(
		format(outputs.yamlQuoteValues, options.yamlQuoteValues)
	).resolves.toBe(outputs.yamlQuoteValues);
});

test('formats output from other plugins’ parser hooks', async () => {
	const testPlugin: Plugin = {
		parsers: {
			yaml: {
				astFormat: prettierPluginYAML.parsers.yaml.astFormat,
				locEnd: prettierPluginYAML.parsers.yaml.locEnd,
				locStart: prettierPluginYAML.parsers.yaml.locStart,
				preprocess: async () => {
					await new Promise((resolve) => setTimeout(resolve));
					return 'foo: ["bar", "baz"]';
				},
			} as unknown as Parser,
		},
	};

	const emptyPlugin: Plugin = {};

	const options = {
		parser: 'yaml' as const,
		plugins: [testPlugin, emptyPlugin, pluginYAML],
	};

	const output = await format(TEST_YAML, options);

	expect(output).toMatchInlineSnapshot(`
		"foo: [bar, baz]
		"
	`);
});

test('reports YAML errors from other plugins’ `preprocess` hooks without source locations', async () => {
	const testPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierPluginYAML.parsers.yaml,
				preprocess: (text) => `${text}foo: baz\n`,
			},
		},
	};

	const error = await getSyntaxError(
		format('foo: bar\n', {
			parser: 'yaml',
			plugins: [testPlugin, pluginYAML],
		})
	);

	expect(error.message).toMatchInlineSnapshot(`
		"[prettier-plugin-yaml] Failed to parse YAML. Locations refer to the parser input:

		Map keys must be unique at line 2, column 1:

		foo: bar
		foo: baz
		^
		"
	`);
	expect(error).not.toHaveProperty('loc');
	expect(error.cause).toBeInstanceOf(YAMLParseError);
});

test('formats newline-only files as empty', async () => {
	const options = {
		parser: 'yaml' as const,
		plugins: [pluginYAML],
	};

	const output = await format('\n', options);

	expect(output).toBe('');
	await expect(format(output, options)).resolves.toBe(output);
});

test('preserves comment-only files', async () => {
	const input = '# Comment\n';

	const output = await format(input, {
		parser: 'yaml',
		plugins: [pluginYAML],
	});

	expect(output).toBe(input);
});

test('formats in standalone mode', async () => {
	const options = {
		parser: 'yaml' as const,
		plugins: [prettierPluginYAML, pluginYAML],
	};

	const expectedOutput = await format(TEST_YAML, options);
	const output = await standaloneFormat(TEST_YAML, options);

	expect(output).toBe(expectedOutput);
});

import type { Parser, Plugin } from 'prettier';
import type { PluginOptions } from './index.ts';
import { format, formatWithCursor } from 'prettier';
import * as prettierPluginYAML from 'prettier/plugins/yaml';
import { format as standaloneFormat } from 'prettier/standalone';
import { expect, expectTypeOf, test } from 'vite-plus/test';
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

test.each([
	['0', '-0'],
	['1', '0o1'],
	['1', '0x1'],
	['1.0', '1e0'],
] as const)(
	'rejects equivalent numeric mapping keys `%s` and `%s`',
	async (left, right) => {
		const input = `${left}: foo\n${right}: bar\n`;

		await expect(
			format(input, {
				parser: 'yaml',
				plugins: [pluginYAML],
				yamlCollectionStyle: 'flow',
			})
		).rejects.toThrow('Document with errors cannot be stringified');
	}
);

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
	).rejects.toThrow('Document with errors cannot be stringified');
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
])(
	'respects `rangeStart` and `rangeEnd` from %i to %i',
	async (rangeStart, rangeEnd) => {
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
	}
);

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

test('works with other plugins', async () => {
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

test('handles empty files', async () => {
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

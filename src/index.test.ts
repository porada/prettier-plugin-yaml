import type { Plugin } from 'prettier';
import type { PluginOptions } from './index.ts';
import { format, formatWithCursor } from 'prettier';
import * as prettierPluginYAML from 'prettier/plugins/yaml';
import { format as standaloneFormat } from 'prettier/standalone';
import { expect, expectTypeOf, test } from 'vite-plus/test';
import * as pluginYAML from './index.ts';

test('exposes correct public API', () => {
	expectTypeOf(pluginYAML).toExtend<Plugin>();

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

test('formats YAML', async () => {
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
	});

	expect(output).toMatchSnapshot();
});

test('respects `bracketSpacing`', async () => {
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		bracketSpacing: false,
	});

	expect(output).toMatchSnapshot();
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

	await expect(format(output, options)).resolves.toBe(output);
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

	const outputs: string[] = [];

	for (const embeddedLanguageFormatting of ['auto', 'off'] as const) {
		outputs.push(
			await format(input, {
				embeddedLanguageFormatting,
				parser: 'markdown',
				plugins: [pluginYAML],
				yamlQuoteValues: true,
			})
		);
	}

	expect(outputs).toMatchInlineSnapshot(`
		[
		  "\`\`\`yaml
		foo: ["bar", "baz"]
		\`\`\`
		",
		  "\`\`\`yaml
		foo: [bar,baz]
		\`\`\`
		",
		]
	`);
});

test('respects `endOfLine`', async () => {
	const output = await format('foo: bar\nbaz: qux\n', {
		endOfLine: 'crlf',
		parser: 'yaml',
		plugins: [pluginYAML],
	});

	expect(output).toBe('foo: bar\r\nbaz: qux\r\n');
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

	const expectedOutput = await format(input, { parser: 'yaml' });
	const output = await format(input, {
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlQuoteValues: true,
	});

	expect(output).toBe(expectedOutput);
	expect(output).toMatchInlineSnapshot(`
		"foo:
		  # prettier-ignore
		  ignored: [foo,bar]
		formatted: [baz, qux]
		"
	`);
});

test('respects `printWidth`', async () => {
	const output = await format('foo: [alpha, beta, gamma, delta]\n', {
		parser: 'yaml',
		plugins: [pluginYAML],
		printWidth: 12,
	});

	expect(output).toMatchInlineSnapshot(`
		"foo:
		  [
		    alpha,
		    beta,
		    gamma,
		    delta,
		  ]
		"
	`);
});

test('respects `proseWrap`', async () => {
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		proseWrap: 'always',
	});

	expect(output).toMatchSnapshot();
});

test('respects `rangeStart` and `rangeEnd`', async () => {
	const input = 'first: [alpha,beta]\nsecond: [gamma,delta]\n';

	for (const [rangeStart, rangeEnd] of [
		[0, input.indexOf('second')],
		[input.indexOf('second'), input.length],
	]) {
		const expectedOutput = await format(input, {
			parser: 'yaml',
			rangeEnd,
			rangeStart,
		});
		const output = await format(input, {
			parser: 'yaml',
			plugins: [pluginYAML],
			rangeEnd,
			rangeStart,
			yamlQuoteValues: true,
		});

		expect(output).toBe(expectedOutput);
	}
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
	const output = await format('foo: "bar: baz"\n', {
		parser: 'yaml',
		plugins: [pluginYAML],
		singleQuote: true,
	});

	expect(output).toMatchInlineSnapshot(`
		"foo: 'bar: baz'
		"
	`);
});

test('respects `tabWidth`', async () => {
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		tabWidth: 4,
	});

	expect(output).toMatchSnapshot();
});

test('respects `trailingComma`', async () => {
	const output = await format('{ foo: [bar, baz], qux: { quux: corge } }\n', {
		parser: 'yaml',
		plugins: [pluginYAML],
		printWidth: 20,
		trailingComma: 'none',
	});

	expect(output).toMatchInlineSnapshot(`
		"{
		  foo: [bar, baz],
		  qux:
		    { quux: corge }
		}
		"
	`);
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
	for (const yamlBlockStyle of ['folded', 'literal'] as const) {
		const output = await format(TEST_YAML, {
			parser: 'yaml',
			plugins: [pluginYAML],
			yamlBlockStyle,
		});

		expect(output).toMatchSnapshot();
	}
});

test('supports `yamlCollectionStyle`', async () => {
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlCollectionStyle: 'block',
	});

	expect(output).toMatchSnapshot();

	for (const bracketSpacing of [true, false] as const) {
		const output = await format(TEST_YAML, {
			parser: 'yaml',
			plugins: [pluginYAML],
			bracketSpacing,
			yamlCollectionStyle: 'flow',
		});

		expect(output).toMatchSnapshot();
	}
});

test('supports `yamlQuoteKeys`', async () => {
	let output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlQuoteKeys: true,
	});

	expect(output).toMatchSnapshot();

	output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		singleQuote: true,
		yamlQuoteKeys: true,
	});

	expect(output).toMatchSnapshot();

	output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlCollectionStyle: 'flow',
		yamlQuoteKeys: true,
	});

	expect(output).toMatchSnapshot();
});

test('supports `yamlQuoteKeysMatching`', async () => {
	let output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlQuoteKeysMatching: '-',
	});

	expect(output).toMatchSnapshot();

	output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlQuoteKeys: true,
		yamlQuoteKeysMatching: '^\\d+$',
	});

	expect(output).toMatchSnapshot();
});

test('supports `yamlQuoteValues`', async () => {
	let output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlQuoteValues: true,
	});

	expect(output).toMatchSnapshot();

	output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		singleQuote: true,
		yamlQuoteValues: true,
	});

	expect(output).toMatchSnapshot();

	output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		singleQuote: true,
		yamlQuoteKeys: true,
		yamlQuoteValues: true,
	});

	expect(output).toMatchSnapshot();

	output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlCollectionStyle: 'flow',
		yamlQuoteValues: true,
	});

	expect(output).toMatchSnapshot();
});

test('supports `yamlQuoteValuesMatching`', async () => {
	let output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlQuoteValuesMatching: '[\\s/]',
	});

	expect(output).toMatchSnapshot();

	output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlQuoteValuesMatching: '^\\d+(:\\d+)?$',
	});

	expect(output).toMatchSnapshot();

	output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		yamlQuoteValues: true,
		yamlQuoteValuesMatching: '^(\\d+|true|false|null)$',
	});

	expect(output).toMatchSnapshot();
});

test('works with other plugins', async () => {
	const testPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierPluginYAML.parsers.yaml,
				parse: () => {},
				preprocess: async () => {
					await new Promise((resolve) => setTimeout(resolve));
					return 'foo: ["bar", "baz"]';
				},
			},
		},
	};

	/* @ts-expect-error */
	delete testPlugin.parsers.yaml.parse;

	const emptyPlugin: Plugin = {};

	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [testPlugin, emptyPlugin, pluginYAML],
	});

	expect(output).toMatchInlineSnapshot(`
		"foo: [bar, baz]
		"
	`);
});

test('handles empty files', async () => {
	const output = await format('\n', {
		parser: 'yaml',
		plugins: [pluginYAML],
	});

	expect(output).toBe('');
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
	const output = await standaloneFormat(TEST_YAML, {
		parser: 'yaml',
		plugins: [prettierPluginYAML, pluginYAML],
	});

	expect(output).toMatchSnapshot();
});

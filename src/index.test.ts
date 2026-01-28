import type { Plugin } from 'prettier';
import type { PluginOptions } from './index.ts';
import { format } from 'prettier';
import { parsers as prettierParsers } from 'prettier/plugins/yaml';
import { expect, expectTypeOf, test } from 'vitest';
import * as pluginYAML from './index.ts';

const TEST_YAML = `
version: 2

description: >
  You can use Dependabot to keep the packages you use updated to the latest versions.

updates:
  - package-ecosystem: github-actions
    directory: '/'
    schedule:
      { interval: 'weekly' }

  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: "daily"
    versioning-strategy: "increase"
    ignore:
      - dependency-name: |
          @standard-config/prettier
`;

test('exposes correct public API', () => {
	expectTypeOf(pluginYAML).toExtend<Plugin>();

	expect(pluginYAML).toHaveProperty('parsers');
	expect(pluginYAML.parsers).toHaveProperty('yaml');

	expectTypeOf<PluginOptions>().toBeObject();
});

test('formats YAML', async () => {
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
	});

	expect(output).toMatchSnapshot();
});

test('respects `tabWidth`', async () => {
	const output = await format(TEST_YAML, {
		parser: 'yaml',
		plugins: [pluginYAML],
		tabWidth: 4,
	});

	expect(output).toMatchSnapshot();
});

test('supports `yamlCollectionStyle`', async () => {
	for (const value of ['block', 'flow'] as const) {
		const output = await format(TEST_YAML, {
			parser: 'yaml',
			plugins: [pluginYAML],
			yamlCollectionStyle: value,
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
});

test('works with other plugins', async () => {
	const testPlugin: Plugin = {
		parsers: {
			yaml: {
				...prettierParsers.yaml,
				parse: () => {},
				preprocess: async () => {
					/* oxlint-disable-next-line eslint/no-promise-executor-return */
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

	expect(output).toMatchSnapshot();
});

test('handles empty files', async () => {
	const output = await format('\n', {
		parser: 'yaml',
		plugins: [pluginYAML],
	});

	expect(output).toBe('');
});

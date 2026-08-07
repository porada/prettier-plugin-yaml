import type { ParserOptions } from 'prettier';
import type { PluginOptions } from '../types/index.d.ts';
import { expect, test } from 'vite-plus/test';
import { parseAllDocuments, parseDocument } from 'yaml';
import preprocessYAML from './index.ts';

function preprocess(
	text: string,
	options: Partial<ParserOptions> & PluginOptions = {}
): string {
	return preprocessYAML(text, options as ParserOptions & PluginOptions);
}

test('handles multi-document YAML streams', () => {
	const input = `---
# Comment 1️⃣
foo: bar
...
---
# Comment 2️⃣
baz: qux
...
`;

	const options = { yamlQuoteValues: true };
	const output = preprocess(input, options);
	const inputDocuments = parseAllDocuments(input);
	const outputDocuments = parseAllDocuments(output);

	expect(output).toMatchInlineSnapshot(`
		"---
		# Comment 1️⃣
		foo: "bar"
		...
		---
		# Comment 2️⃣
		baz: "qux"
		...
		"
	`);

	expect(outputDocuments).toHaveLength(2);
	expect(outputDocuments.map((document) => document.toJS())).toStrictEqual(
		inputDocuments.map((document) => document.toJS())
	);

	expect(preprocess(output, options)).toBe(output);
});

test('respects `prettier-ignore` comments', () => {
	const input = `# prettier-ignore
foo: [bar,baz]
baz: qux
`;

	expect(preprocess(input, { yamlQuoteValues: true })).toBe(input);
});

test('supports empty quote-matching patterns', () => {
	const input = 'foo: bar\n';
	const options = {
		yamlQuoteKeysMatching: '',
		yamlQuoteValuesMatching: '',
	};
	const output = preprocess(input, options);

	expect(output).toMatchInlineSnapshot(`
		""foo": "bar"
		"
	`);

	expect(preprocess(output, options)).toBe(output);
});

test('supports explicitly tagged string merge-like keys', () => {
	const input = '!!str <<: value\n';
	const expectedOutput = '!!str "<<": value\n';

	for (const options of [
		{ yamlQuoteKeys: true },
		{ yamlQuoteKeysMatching: '^<<$' },
	] as const) {
		const output = preprocess(input, options);

		expect(output).toBe(expectedOutput);
		expect(parseDocument(output).toJS({ mapAsMap: true })).toStrictEqual(
			parseDocument(input).toJS({ mapAsMap: true })
		);

		expect(preprocess(output, options)).toBe(output);
	}
});

test('supports quote and flow collection style precedence', () => {
	const input = `foo: |-
  bar
`;

	for (const { expectedOutput, options } of [
		{
			expectedOutput: 'foo: "bar"\n',
			options: {
				yamlBlockStyle: 'literal',
				yamlQuoteValues: true,
			},
		},
		{
			expectedOutput: '{ foo: bar }\n',
			options: {
				yamlBlockStyle: 'literal',
				yamlCollectionStyle: 'flow',
			},
		},
	] as const) {
		const output = preprocess(input, options);

		expect(output).toBe(expectedOutput);
		expect(parseDocument(output).toJS()).toStrictEqual(
			parseDocument(input).toJS()
		);

		expect(preprocess(output, options)).toBe(output);
	}
});

test('supports `yamlBlockStyle` with plain multiline values', () => {
	const input = `foo: bar

  baz
`;

	for (const [yamlBlockStyle, expectedOutput] of [
		[
			'folded',
			`foo: >-
  bar

  baz
`,
		],
		[
			'literal',
			`foo: |-
  bar
  baz
`,
		],
	] as const) {
		const options = { yamlBlockStyle };
		const output = preprocess(input, options);

		expect(output).toBe(expectedOutput);

		expect(preprocess(output, options)).toBe(output);
	}
});

test('supports `yamlQuoteKeys` with non-string keys', () => {
	const input = `0: foo
true: bar
null: baz
`;
	const options = { yamlQuoteKeys: true };
	const output = preprocess(input, options);

	expect(output).toMatchInlineSnapshot(`
		""0": foo
		"true": bar
		"null": baz
		"
	`);

	expect(preprocess(output, options)).toBe(output);
});

test('supports `yamlQuoteValues` with block scalar values', () => {
	const input = `foo: |-
  bar
`;
	const options = { yamlQuoteValues: true };
	const output = preprocess(input, options);

	expect(output).toMatchInlineSnapshot(`
		"foo: "bar"
		"
	`);

	expect(preprocess(output, options)).toBe(output);
});

test('preserves block scalar content containing `prettier-ignore`', () => {
	const input = `foo: |
  # prettier-ignore
`;

	const output = preprocess(input, { yamlQuoteKeys: true });

	expect(output).toMatchInlineSnapshot(`
		""foo": |
		  # prettier-ignore
		"
	`);
});

test('preserves explicit block scalar indentation', () => {
	const input = `foo: |2-
   bar
`;

	const output = preprocess(input);

	expect(output).toBe(input);
	expect(parseDocument(output).toJS()).toStrictEqual(
		parseDocument(input).toJS()
	);

	expect(preprocess(output)).toBe(output);
});

test('preserves comments after `prettier-ignore` comments', () => {
	const input = `# prettier-ignore
# Comment
foo: bar
baz: qux
`;
	const expectedOutput = `# prettier-ignore
# Comment
foo: "bar"
baz: "qux"
`;

	expect(preprocess(input, { yamlQuoteValues: true })).toBe(expectedOutput);
});

test('preserves suffixed `prettier-ignore` comments', () => {
	const input = `# prettier-ignore because
foo: bar
baz: qux
`;
	const expectedOutput = `# prettier-ignore because
foo: "bar"
baz: "qux"
`;

	expect(preprocess(input, { yamlQuoteValues: true })).toBe(expectedOutput);
});

test('preserves trailing comments containing `prettier-ignore`', () => {
	const input = `foo: bar # prettier-ignore
baz: qux
`;
	const expectedOutput = `foo: "bar" # prettier-ignore
baz: "qux"
`;

	expect(preprocess(input, { yamlQuoteValues: true })).toBe(expectedOutput);
});

test('preserves quoted merge-like keys', () => {
	const input = `foo: &foo
  bar: baz
qux:
  "<<": *foo
`;
	const output = preprocess(input);

	expect(output).toBe(input);
	expect(parseDocument(output, { merge: true }).toJS()).toStrictEqual(
		parseDocument(input, { merge: true }).toJS()
	);

	expect(preprocess(output)).toBe(output);
});

test('preserves merge keys with key-quoting options', () => {
	const input = `foo: &foo
  bar: baz
qux:
  <<: *foo
`;
	const expectedOutput = `"foo": &foo
  "bar": baz
"qux":
  <<: *foo
`;

	for (const options of [
		{ yamlQuoteKeys: true },
		{ yamlQuoteKeysMatching: '.*' },
	] as const) {
		const output = preprocess(input, options);

		expect(output).toBe(expectedOutput);
		expect(parseDocument(output, { merge: true }).toJS()).toStrictEqual(
			parseDocument(input, { merge: true }).toJS()
		);

		expect(preprocess(output, options)).toBe(output);
	}
});

test('preserves explicitly tagged keys with key-quoting options', () => {
	const input = `? !!timestamp 2001-12-15T02:59:43.123Z
: foo
? !!binary SGVsbG8=
: bar
`;
	const expectedOutput = `!!timestamp 2001-12-15T02:59:43.123Z: foo
!!binary SGVsbG8=: bar
`;

	for (const options of [
		{ yamlQuoteKeys: true },
		{ yamlQuoteKeysMatching: '.*' },
	] as const) {
		const output = preprocess(input, options);

		expect(output).toBe(expectedOutput);
		expect(parseDocument(output).toJS({ mapAsMap: true })).toStrictEqual(
			parseDocument(input).toJS({ mapAsMap: true })
		);

		expect(preprocess(output, options)).toBe(output);
	}
});

test('preserves explicitly tagged values with quote matching', () => {
	const input = `foo: !!timestamp 2001-12-15T02:59:43.123Z
bar: !!binary SGVsbG8=
`;
	const options = { yamlQuoteValuesMatching: '.*' };
	const output = preprocess(input, options);

	expect(output).toBe(input);
	expect(parseDocument(output).toJS()).toStrictEqual(
		parseDocument(input).toJS()
	);

	expect(preprocess(output, options)).toBe(output);
});

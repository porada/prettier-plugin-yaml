import type { ParserOptions } from 'prettier';
import type { PluginOptions } from '../types/index.d.ts';
import { expect, test } from 'vite-plus/test';
import { parseDocument } from 'yaml';
import preprocessYAML from './index.ts';

function preprocess(
	text: string,
	options: Partial<ParserOptions> & PluginOptions = {}
): string {
	return preprocessYAML(text, options as ParserOptions & PluginOptions);
}

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

test('gives quote and flow collection styles precedence over block style', () => {
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

test('preserves block scalar indentation with `tabWidth`', () => {
	const input = `foo: |2-
   bar
`;
	const options = { tabWidth: 4 };
	const output = preprocess(input, options);

	expect(output).toBe(input);
	expect(parseDocument(output).toJS()).toStrictEqual(
		parseDocument(input).toJS()
	);
	expect(preprocess(output, options)).toBe(output);
});

test('supports `yamlQuoteKeys` with non-string keys', () => {
	const input = `0: foo
true: bar
null: baz
`;
	const options = { yamlQuoteKeys: true };
	const output = preprocess(input, options);

	expect(output).toBe(`"0": foo
"true": bar
"null": baz
`);
	expect(preprocess(output, options)).toBe(output);
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

test('quotes explicitly tagged string merge-like keys', () => {
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

test('supports `yamlQuoteValues` with block scalar values', () => {
	const input = `foo: |-
  bar
`;
	const options = { yamlQuoteValues: true };
	const output = preprocess(input, options);

	expect(output).toBe('foo: "bar"\n');
	expect(preprocess(output, options)).toBe(output);
});

test('supports empty quote-matching patterns', () => {
	const input = 'foo: bar\n';
	const options = {
		yamlQuoteKeysMatching: '',
		yamlQuoteValuesMatching: '',
	};
	const output = preprocess(input, options);

	expect(output).toBe('"foo": "bar"\n');
	expect(preprocess(output, options)).toBe(output);
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

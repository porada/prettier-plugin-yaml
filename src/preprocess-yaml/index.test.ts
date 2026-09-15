import type { ParserOptions } from 'prettier';
import type * as YAML from 'yaml';
import type { PluginOptions } from '../types/index.d.ts';
import { expect, test, vi } from 'vite-plus/test';
import { parseAllDocuments, parseDocument } from 'yaml';
import preprocessYAML, { createPreprocessState } from './index.ts';

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

test('respects `originalText` when preserving source positions', () => {
	const text = 'foo: bar\n';
	const originalText = `${text}baz: qux\n`;

	expect(
		createPreprocessState(text, {
			originalText,
			rangeEnd: text.length,
		} as ParserOptions)
	).toStrictEqual({ preserveSourcePositions: true });
});

test('respects `prettier-ignore` comments', () => {
	const input = `# prettier-ignore
foo: [bar,baz]
baz: qux
`;

	expect(preprocess(input, { yamlQuoteValues: true })).toBe(input);
});

test('respects `rangeStart` and `rangeEnd` without a native pragma inserter', async () => {
	const text = 'foo: bar\n';

	vi.resetModules();
	vi.doMock('prettier/plugins/yaml', () => ({
		printers: { yaml: {} },
	}));

	try {
		const { createPreprocessState: createState } =
			await import('./index.ts');

		expect(
			createState(text, {
				insertPragma: true,
				rangeEnd: text.length,
				rangeStart: 0,
			} as ParserOptions)
		).toStrictEqual({ preserveSourcePositions: false });
	} finally {
		vi.doUnmock('prettier/plugins/yaml');
		vi.resetModules();
	}
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

test('preserves numeric precision', () => {
	for (const value of [
		'-0',
		'-9007199254740993',
		'.inf',
		'.nan',
		'0.1234567890123456789',
		'0o400000000000000001',
		'0x20000000000001',
		'1e-400',
		'1e400',
		'9007199254740993',
	]) {
		const input = `foo: ${value}\n`;
		const output = preprocess(input);

		expect(output).toBe(input);

		expect(preprocess(output)).toBe(output);
	}
});

test('stringifies numeric scalars without source text', async () => {
	const input = 'foo: 1\nbar: 0.5\n';

	vi.resetModules();
	vi.doMock('yaml', async (importOriginal) => {
		const yaml = await importOriginal<typeof YAML>();

		return {
			...yaml,
			parseAllDocuments: (
				...args: Parameters<typeof parseAllDocuments>
			) => {
				const documents = yaml.parseAllDocuments(...args);

				for (const document of documents) {
					yaml.visit(document, {
						Scalar(_key, node) {
							if (typeof node.value === 'number') {
								delete node.source;
							}
						},
					});
				}

				return documents;
			},
		};
	});

	try {
		const { default: preprocessWithoutSource } = await import('./index.ts');
		const options = {} as ParserOptions;
		const output = preprocessWithoutSource(input, options);

		expect(output).toBe(input);

		expect(preprocessWithoutSource(output, options)).toBe(output);
	} finally {
		vi.doUnmock('yaml');
		vi.resetModules();
	}
});

test('preserves numeric precision in distinct mapping keys', () => {
	const input = `9007199254740992: foo
9007199254740993: bar
0.1234567890123456788: baz
0.1234567890123456789: qux
`;

	const output = preprocess(input);

	expect(output).toBe(input);

	expect(preprocess(output)).toBe(output);
});

test('preserves numeric precision in tagged scalars and aliases', () => {
	const input = `foo: &foo !!int 9007199254740993
bar: *foo
baz: !!float 0.1234567890123456789
`;

	const options = {
		yamlQuoteKeysMatching: '.*',
		yamlQuoteValuesMatching: '.*',
	};

	const expectedOutput = `"foo": &foo !!int 9007199254740993
"bar": *foo
"baz": !!float 0.1234567890123456789
`;

	const output = preprocess(input, options);

	expect(output).toBe(expectedOutput);

	expect(preprocess(output, options)).toBe(output);
});

test('preserves strings with explicit numeric tags', () => {
	for (const tag of ['!!float', '!!int']) {
		const input = `foo: ${tag} "bar: baz"
qux: ${tag} "# Comment"
`;

		for (const options of [{}, { yamlQuoteValues: true }]) {
			const output = preprocess(input, options);

			expect(output).toBe(input);
			expect(parseDocument(output).toJS()).toStrictEqual(
				parseDocument(input).toJS()
			);

			expect(preprocess(output, options)).toBe(output);
		}
	}
});

test('preserves numeric precision in YAML 1.1 documents', () => {
	const input = `%YAML 1.1
---
foo: 9_007_199_254_740_993
bar: 0b100000000000000000000000000000000000000000000000000001
baz: 0.123_456_789_012_345_678_9
qux: 9007199254740993:00
`;

	const output = preprocess(input);

	expect(output).toBe(input);

	expect(preprocess(output)).toBe(output);
});

test('preserves numeric precision when quoting keys and values', () => {
	const input = '9007199254740993: 0.1234567890123456789\n';

	for (const [options, expectedOutput] of [
		[
			{
				yamlQuoteKeys: true,
			},
			'"9007199254740993": 0.1234567890123456789\n',
		],
		[
			{
				yamlQuoteKeysMatching: '^9007199254740993$',
			},
			'"9007199254740993": 0.1234567890123456789\n',
		],
		[
			{
				yamlQuoteValuesMatching: '^0\\.1234567890123456789$',
			},
			'9007199254740993: "0.1234567890123456789"\n',
		],
	] as const) {
		const output = preprocess(input, options);

		expect(output).toBe(expectedOutput);

		expect(preprocess(output, options)).toBe(output);
	}
});

test('rejects duplicate mapping keys', () => {
	for (const key of ['0.1234567890123456789', '9007199254740993', 'foo']) {
		const input = `${key}: bar\n${key}: baz\n`;

		expect(() => preprocess(input)).toThrow(
			'Document with errors cannot be stringified'
		);
	}
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

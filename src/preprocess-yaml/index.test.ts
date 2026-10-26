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
	return preprocessYAML(
		text,
		options as unknown as ParserOptions & PluginOptions
	);
}

test('handles multi-document YAML streams', () => {
	const input = `---
# Comment 1
foo: bar
...
---
# Comment 2
baz: qux
...
`;

	const options = { yamlQuoteValues: true };
	const output = preprocess(input, options);
	const inputDocuments = parseAllDocuments(input);
	const outputDocuments = parseAllDocuments(output);

	expect(output).toMatchInlineSnapshot(`
		"---
		# Comment 1
		foo: "bar"
		...
		---
		# Comment 2
		baz: "qux"
		...
		"
	`);
	expect(preprocess(output, options)).toBe(output);

	expect(outputDocuments).toHaveLength(2);
	expect(outputDocuments.map((document) => document.toJS())).toStrictEqual(
		inputDocuments.map((document) => document.toJS())
	);
});

test('respects `originalText` when preserving source positions', () => {
	const input = 'foo: bar\n';
	const originalText = `${input}baz: qux\n`;

	expect(
		createPreprocessState(input, {
			originalText,
			rangeEnd: input.length,
		} as unknown as ParserOptions)
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
	const input = 'foo: bar\n';

	vi.resetModules();
	vi.doMock('prettier/plugins/yaml', () => ({
		printers: { yaml: {} },
	}));

	try {
		const { createPreprocessState: createState } =
			await import('./index.ts');

		expect(
			createState(input, {
				insertPragma: true,
				rangeEnd: input.length,
				rangeStart: 0,
			} as unknown as ParserOptions)
		).toStrictEqual({ preserveSourcePositions: false });
	} finally {
		vi.doUnmock('prettier/plugins/yaml');
		vi.resetModules();
	}
});

test('supports empty quote matching patterns', () => {
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

test.each([
	{ yamlQuoteKeys: true },
	{ yamlQuoteKeysMatching: '^<<$' },
] as const)('supports explicitly tagged string merge-like keys', (options) => {
	const input = '!!str <<: foo\n';
	const expectedOutput = '!!str "<<": foo\n';
	const output = preprocess(input, options);

	expect(output).toBe(expectedOutput);
	expect(preprocess(output, options)).toBe(output);
	expect(parseDocument(output).toJS({ mapAsMap: true })).toStrictEqual(
		parseDocument(input).toJS({ mapAsMap: true })
	);
});

test.each([
	{
		options: {
			yamlBlockStyle: 'literal',
			yamlQuoteValues: true,
		},
		output: 'foo: "bar"\n',
	},
	{
		options: {
			yamlBlockStyle: 'literal',
			yamlCollectionStyle: 'flow',
		},
		output: '{ foo: bar }\n',
	},
] as const)(
	'supports quote and flow collection style precedence',
	({ options, output: expectedOutput }) => {
		const input = `foo: |-
  bar
`;
		const output = preprocess(input, options);

		expect(output).toBe(expectedOutput);
		expect(preprocess(output, options)).toBe(output);
		expect(parseDocument(output).toJS()).toStrictEqual(
			parseDocument(input).toJS()
		);
	}
);

test.each([
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
] as const)(
	'supports `yamlBlockStyle: %s` with plain multi-line values',
	(yamlBlockStyle, expectedOutput) => {
		const input = `foo: bar

  baz
`;
		const options = { yamlBlockStyle };
		const output = preprocess(input, options);

		expect(output).toBe(expectedOutput);
		expect(preprocess(output, options)).toBe(output);
	}
);

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
	const input = `# prettier-ignore foo
bar: baz
qux: quux
`;
	const expectedOutput = `# prettier-ignore foo
bar: "baz"
qux: "quux"
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

test.each([
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
])('preserves numeric precision of `%s`', (value) => {
	const input = `foo: ${value}\n`;
	const output = preprocess(input);

	expect(output).toBe(input);
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
		const options = {} as unknown as ParserOptions;
		const output = preprocessWithoutSource(input, options);

		expect(output).toBe(input);
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

test.each([
	['!!float', {}],
	['!!float', { yamlQuoteValues: true }],
	['!!int', {}],
	['!!int', { yamlQuoteValues: true }],
] as const)('preserves strings with an explicit `%s` tag', (tag, options) => {
	const input = `foo: ${tag} "bar: baz"
qux: ${tag} "# Comment"
`;
	const output = preprocess(input, options);

	expect(output).toBe(input);
	expect(parseDocument(output).toJS()).toStrictEqual(
		parseDocument(input).toJS()
	);
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
});

test.each([
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
			/* oxlint-disable-next-line unicorn/prefer-string-raw */
			yamlQuoteValuesMatching: '^0\\.1234567890123456789$',
		},
		'9007199254740993: "0.1234567890123456789"\n',
	],
] as const)(
	'preserves numeric precision when quoting keys and values',
	(options, expectedOutput) => {
		const input = '9007199254740993: 0.1234567890123456789\n';
		const output = preprocess(input, options);

		expect(output).toBe(expectedOutput);
		expect(preprocess(output, options)).toBe(output);
	}
);

test.each(['0.1234567890123456789', '9007199254740993', 'foo'])(
	'rejects duplicate `%s` mapping keys',
	(key) => {
		const input = `${key}: bar\n${key}: baz\n`;

		expect(() => preprocess(input)).toThrow(
			'Document with errors cannot be stringified'
		);
	}
);

test.each([
	['0', '-0'],
	['1', '0o1'],
	['1', '0x1'],
	['1.0', '1e0'],
] as const)(
	'rejects equivalent numeric mapping keys `%s` and `%s`',
	(left, right) => {
		const input = `${left}: foo\n${right}: bar\n`;

		expect(() =>
			preprocess(input, { yamlCollectionStyle: 'flow' })
		).toThrow('Document with errors cannot be stringified');
	}
);

test('rejects equivalent numeric mapping keys in YAML 1.1 documents', () => {
	const input = `%YAML 1.1
---
9007199254740993:00: foo
540431955284459580: bar
`;

	expect(() => preprocess(input)).toThrow(
		'Document with errors cannot be stringified'
	);
});

test('preserves distinct numeric mapping keys in YAML 1.1 documents', () => {
	const input = `%YAML 1.1
---
9007199254740992:00: foo
9007199254740993:00: bar
`;

	const output = preprocess(input);

	expect(output).toBe(input);
});

test.each(['1.1', '1.2'])(
	'preserves NaN mapping keys in YAML %s documents',
	(version) => {
		const input = `%YAML ${version}\n---\n.nan: foo\n.nan: bar\n`;
		const output = preprocess(input);

		expect(output).toBe(input);
	}
);

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
});

test.each([{ yamlQuoteKeys: true }, { yamlQuoteKeysMatching: '.*' }] as const)(
	'preserves merge keys with key quoting options',
	(options) => {
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
		const output = preprocess(input, options);

		expect(output).toBe(expectedOutput);
		expect(preprocess(output, options)).toBe(output);
		expect(parseDocument(output, { merge: true }).toJS()).toStrictEqual(
			parseDocument(input, { merge: true }).toJS()
		);
	}
);

test.each([{ yamlQuoteKeys: true }, { yamlQuoteKeysMatching: '.*' }] as const)(
	'preserves explicitly tagged keys with key quoting options',
	(options) => {
		const input = `? !!timestamp 2001-12-15T02:59:43.123Z
: foo
? !!binary SGVsbG8=
: bar
`;
		const expectedOutput = `!!timestamp 2001-12-15T02:59:43.123Z: foo
!!binary SGVsbG8=: bar
`;
		const output = preprocess(input, options);

		expect(output).toBe(expectedOutput);
		expect(preprocess(output, options)).toBe(output);
		expect(parseDocument(output).toJS({ mapAsMap: true })).toStrictEqual(
			parseDocument(input).toJS({ mapAsMap: true })
		);
	}
);

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
});

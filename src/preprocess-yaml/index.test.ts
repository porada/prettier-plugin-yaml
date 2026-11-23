import type { ParserOptions } from 'prettier';
import type * as YAML from 'yaml';
import type { PluginOptions } from '../types/index.d.ts';
import { expect, test, vi } from 'vite-plus/test';
import { parseAllDocuments, parseDocument, YAMLParseError } from 'yaml';
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

function getSyntaxError(callback: () => unknown): SyntaxError {
	try {
		callback();
	} catch (error) {
		if (error instanceof SyntaxError) {
			return error;
		}

		throw error;
	}

	throw new TypeError('Expected a `SyntaxError`');
}

test('quotes values in each document of a multi-document stream', () => {
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
	).toStrictEqual({
		mayHaveInsertedPragma: false,
		preserveSourcePositions: true,
		sourceText: input,
	});
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
		).toStrictEqual({
			mayHaveInsertedPragma: false,
			preserveSourcePositions: false,
			sourceText: input,
		});
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
] as const)('quotes explicitly tagged string merge-like keys', (options) => {
	const input = '!!str <<: foo\n';
	const expectedOutput = '!!str "<<": foo\n';
	const output = preprocess(input, options);

	expect(output).toBe(expectedOutput);
	expect(preprocess(output, options)).toBe(output);
	expect(parseDocument(output).toJS({ mapAsMap: true })).toStrictEqual(
		parseDocument(input).toJS({ mapAsMap: true })
	);
});

test('prefers `yamlQuoteValues` and flow `yamlCollectionStyle` over `yamlBlockStyle`', () => {
	const input = `foo: |-
  bar
`;
	const options = {
		yamlCollectionStyle: {
			yamlBlockStyle: 'literal',
			yamlCollectionStyle: 'flow',
		},
		yamlQuoteValues: {
			yamlBlockStyle: 'literal',
			yamlQuoteValues: true,
		},
	} as const;

	const outputs = {
		yamlCollectionStyle: preprocess(input, options.yamlCollectionStyle),
		yamlQuoteValues: preprocess(input, options.yamlQuoteValues),
	};

	expect(outputs).toMatchInlineSnapshot(`
		{
		  "yamlCollectionStyle": "{ foo: bar }
		",
		  "yamlQuoteValues": "foo: "bar"
		",
		}
	`);
	expect(
		preprocess(outputs.yamlCollectionStyle, options.yamlCollectionStyle)
	).toBe(outputs.yamlCollectionStyle);
	expect(preprocess(outputs.yamlQuoteValues, options.yamlQuoteValues)).toBe(
		outputs.yamlQuoteValues
	);
	expect(parseDocument(outputs.yamlCollectionStyle).toJS()).toStrictEqual(
		parseDocument(input).toJS()
	);
	expect(parseDocument(outputs.yamlQuoteValues).toJS()).toStrictEqual(
		parseDocument(input).toJS()
	);
});

test('supports `yamlBlockStyle` with plain multi-line values', () => {
	const input = `foo: bar

  baz
`;
	const options = {
		folded: { yamlBlockStyle: 'folded' },
		literal: { yamlBlockStyle: 'literal' },
	} as const;

	const outputs = {
		folded: preprocess(input, options.folded),
		literal: preprocess(input, options.literal),
	};

	expect(outputs).toMatchInlineSnapshot(`
		{
		  "folded": "foo: >-
		  bar

		  baz
		",
		  "literal": "foo: |-
		  bar
		  baz
		",
		}
	`);
	expect(preprocess(outputs.folded, options.folded)).toBe(outputs.folded);
	expect(preprocess(outputs.literal, options.literal)).toBe(outputs.literal);
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

test('preserves numeric precision', () => {
	expect(preprocess('foo: -0\n')).toBe('foo: -0\n');
	expect(preprocess('foo: -9007199254740993\n')).toBe(
		'foo: -9007199254740993\n'
	);
	expect(preprocess('foo: .inf\n')).toBe('foo: .inf\n');
	expect(preprocess('foo: .nan\n')).toBe('foo: .nan\n');
	expect(preprocess('foo: 0.1234567890123456789\n')).toBe(
		'foo: 0.1234567890123456789\n'
	);
	expect(preprocess('foo: 0o400000000000000001\n')).toBe(
		'foo: 0o400000000000000001\n'
	);
	expect(preprocess('foo: 0x20000000000001\n')).toBe(
		'foo: 0x20000000000001\n'
	);
	expect(preprocess('foo: 1e-400\n')).toBe('foo: 1e-400\n');
	expect(preprocess('foo: 1e400\n')).toBe('foo: 1e400\n');
	expect(preprocess('foo: 9007199254740993\n')).toBe(
		'foo: 9007199254740993\n'
	);
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

test('preserves strings with an explicit tag', () => {
	const floatInput = `foo: !!float "bar: baz"
qux: !!float "# Comment"
`;
	const intInput = `foo: !!int "bar: baz"
qux: !!int "# Comment"
`;
	const options = { yamlQuoteValues: true };

	expect(preprocess(floatInput)).toBe(floatInput);
	expect(preprocess(floatInput, options)).toBe(floatInput);
	expect(preprocess(intInput)).toBe(intInput);
	expect(preprocess(intInput, options)).toBe(intInput);
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

test('preserves numeric precision when quoting keys and values', () => {
	const input = '9007199254740993: 0.1234567890123456789\n';
	const options = {
		yamlQuoteKeys: {
			yamlQuoteKeys: true,
		},
		yamlQuoteKeysMatching: {
			yamlQuoteKeysMatching: '^9007199254740993$',
		},
		yamlQuoteValuesMatching: {
			yamlQuoteValuesMatching: '^0\\.1234567890123456789$',
		},
	};

	const outputs = {
		yamlQuoteKeys: preprocess(input, options.yamlQuoteKeys),
		yamlQuoteKeysMatching: preprocess(input, options.yamlQuoteKeysMatching),
		yamlQuoteValuesMatching: preprocess(
			input,
			options.yamlQuoteValuesMatching
		),
	};

	expect(outputs).toMatchInlineSnapshot(`
		{
		  "yamlQuoteKeys": ""9007199254740993": 0.1234567890123456789
		",
		  "yamlQuoteKeysMatching": ""9007199254740993": 0.1234567890123456789
		",
		  "yamlQuoteValuesMatching": "9007199254740993: "0.1234567890123456789"
		",
		}
	`);
	expect(preprocess(outputs.yamlQuoteKeys, options.yamlQuoteKeys)).toBe(
		outputs.yamlQuoteKeys
	);
	expect(
		preprocess(outputs.yamlQuoteKeysMatching, options.yamlQuoteKeysMatching)
	).toBe(outputs.yamlQuoteKeysMatching);
	expect(
		preprocess(
			outputs.yamlQuoteValuesMatching,
			options.yamlQuoteValuesMatching
		)
	).toBe(outputs.yamlQuoteValuesMatching);
});

test('rejects duplicate mapping keys', () => {
	expect(() =>
		preprocess('0.1234567890123456789: bar\n0.1234567890123456789: baz\n')
	).toThrow('Map keys must be unique');
	expect(() =>
		preprocess('9007199254740993: bar\n9007199254740993: baz\n')
	).toThrow('Map keys must be unique');
	expect(() => preprocess('foo: bar\nfoo: baz\n')).toThrow(
		'Map keys must be unique'
	);
});

test('rejects equivalent numeric mapping keys', () => {
	const options = { yamlCollectionStyle: 'flow' as const };

	expect(() => preprocess('0: foo\n-0: bar\n', options)).toThrow(
		'Map keys must be unique'
	);
	expect(() => preprocess('1: foo\n0o1: bar\n', options)).toThrow(
		'Map keys must be unique'
	);
	expect(() => preprocess('1: foo\n0x1: bar\n', options)).toThrow(
		'Map keys must be unique'
	);
	expect(() => preprocess('1.0: foo\n1e0: bar\n', options)).toThrow(
		'Map keys must be unique'
	);
});

test('rejects equivalent numeric mapping keys in YAML 1.1 documents', () => {
	const input = `%YAML 1.1
---
9007199254740993:00: foo
540431955284459580: bar
`;

	expect(() => preprocess(input)).toThrow('Map keys must be unique');
});

test('reports the first YAML error in document order', () => {
	const input = `---
foo: bar
---
baz: qux
baz: quux
---
[
`;

	const error = getSyntaxError(() => preprocess(input));

	expect(error.message).toMatchInlineSnapshot(`
		"Map keys must be unique at line 5, column 1:

		baz: qux
		baz: quux
		^
		"
	`);
	expect(error).toHaveProperty('loc', {
		end: { column: 2, line: 5 },
		start: { column: 1, line: 5 },
	});
	expect(error.cause).toBeInstanceOf(YAMLParseError);
	expect(error.cause).toHaveProperty('code', 'DUPLICATE_KEY');
	expect(error.cause).toHaveProperty('message', error.message);
});

test('reports YAML errors in text from prior `preprocess` hooks without source locations', () => {
	const input = 'foo: bar\n';
	const preprocessedInput = 'foo: bar\nfoo: baz\n';
	const options = {} as ParserOptions & PluginOptions;

	const error = getSyntaxError(() =>
		preprocessYAML(
			preprocessedInput,
			options,
			createPreprocessState(input, options)
		)
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
	expect(error.cause).toHaveProperty('code', 'DUPLICATE_KEY');
});

test.each(['yamlQuoteKeysMatching', 'yamlQuoteValuesMatching'] as const)(
	'rejects invalid `%s` patterns',
	(name) => {
		const pattern = '(';
		const nativeError = getSyntaxError(() => new RegExp(pattern));

		const error = getSyntaxError(() =>
			preprocess('foo: bar\n', { [name]: pattern })
		);

		expect(error.message).toBe(
			`[prettier-plugin-yaml] Failed to compile the regular expression for \`${name}\`:\n\n${nativeError.message}`
		);
		expect(error).not.toHaveProperty('loc');
		expect(error.cause).toBeInstanceOf(SyntaxError);
		expect(error.cause).toHaveProperty('message', nativeError.message);
	}
);

test('rejects invalid `yamlQuoteKeysMatching` patterns before invalid `yamlQuoteValuesMatching` patterns', () => {
	expect(() =>
		preprocess('foo: bar\n', {
			yamlQuoteKeysMatching: '(',
			yamlQuoteValuesMatching: '[',
		})
	).toThrow('`yamlQuoteKeysMatching`');
});

test('reports YAML errors without source locations when the pragma inserter is unknown', () => {
	const error = getSyntaxError(() =>
		preprocess('foo: bar\nfoo: baz\n', { insertPragma: true })
	);

	expect(error.message).toMatch(
		/^\[prettier-plugin-yaml\] Failed to parse YAML\. Locations refer to the parser input:\n\n/
	);
	expect(error).not.toHaveProperty('loc');
});

test('rejects invalid quote matching patterns before invalid YAML', () => {
	expect(() =>
		preprocess('foo: bar\nfoo: baz\n', { yamlQuoteKeysMatching: '(' })
	).toThrowErrorMatchingInlineSnapshot(`
		[SyntaxError: [prettier-plugin-yaml] Failed to compile the regular expression for \`yamlQuoteKeysMatching\`:

		Invalid regular expression: /(/: Unterminated group]
	`);
});

test('ignores invalid quote matching patterns while preserving source text', () => {
	const input = 'foo: bar\n';
	const ignoredInput = `# prettier-ignore\n${input}`;
	const options = { yamlQuoteValuesMatching: '(' };

	expect(preprocess(input, { ...options, cursorOffset: 0 })).toBe(input);
	expect(preprocess(ignoredInput, options)).toBe(ignoredInput);
});

test('preserves invalid YAML after `prettier-ignore` comments', () => {
	const input = `# prettier-ignore
foo: bar
foo: baz
`;

	expect(preprocess(input, { yamlQuoteValues: true })).toBe(input);
});

test('preserves empty streams with YAML errors', () => {
	const input = '%YAML\n';

	expect(preprocess(input, { yamlQuoteValues: true })).toBe(input);
});

test('omits the source location when the YAML parser supplies no position', async () => {
	let yamlError: YAML.YAMLParseError | undefined;

	vi.resetModules();
	vi.doMock('yaml', async (importOriginal) => {
		const yaml = await importOriginal<typeof YAML>();

		return {
			...yaml,
			parseAllDocuments: (
				...args: Parameters<typeof yaml.parseAllDocuments>
			) => {
				const documents = yaml.parseAllDocuments(...args);
				yamlError = new yaml.YAMLParseError(
					[-1, -1],
					'IMPOSSIBLE',
					'Unexpected error'
				);

				for (const document of documents) {
					document.errors = [yamlError];
				}

				return documents;
			},
		};
	});

	try {
		const { default: preprocessYAMLWithMock } = await import('./index.ts');

		const error = getSyntaxError(() =>
			preprocessYAMLWithMock(
				'foo: bar\n',
				{} as ParserOptions & PluginOptions
			)
		);

		expect(error.message).toBe('Unexpected error');
		expect(error).not.toHaveProperty('loc');
		expect(error.cause).toBe(yamlError);
	} finally {
		vi.doUnmock('yaml');
		vi.resetModules();
	}
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

test('preserves NaN mapping keys in YAML documents', () => {
	const yaml11Input = '%YAML 1.1\n---\n.nan: foo\n.nan: bar\n';
	const yaml12Input = '%YAML 1.2\n---\n.nan: foo\n.nan: bar\n';

	expect(preprocess(yaml11Input)).toBe(yaml11Input);
	expect(preprocess(yaml12Input)).toBe(yaml12Input);
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

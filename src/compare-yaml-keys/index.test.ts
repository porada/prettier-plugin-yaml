import { expect, test } from 'vite-plus/test';
import { parseDocument, Scalar, YAMLMap, YAMLSeq } from 'yaml';
import compareYAMLKeys from './index.ts';

test('matches identical nodes', () => {
	for (const node of [
		new Scalar('foo'),
		new Scalar(Number.NaN),
		new YAMLMap(),
		new YAMLSeq(),
	]) {
		expect(compareYAMLKeys(node, node)).toBe(true);
	}
});

test('preserves distinct non-scalar keys', () => {
	const scalar = new Scalar('foo');

	for (const node of [new YAMLMap(), new YAMLSeq()]) {
		expect(compareYAMLKeys(node, scalar)).toBe(false);
		expect(compareYAMLKeys(scalar, node)).toBe(false);
	}

	expect(compareYAMLKeys(new YAMLMap(), new YAMLMap())).toBe(false);
	expect(compareYAMLKeys(new YAMLSeq(), new YAMLSeq())).toBe(false);
});

test('compares nonnumeric scalar values', () => {
	for (const [left, right, expected] of [
		['false', 'false', true],
		['false', 'true', false],
		['foo', 'bar', false],
		['foo', 'foo', true],
		['null', 'null', true],
	] as const) {
		expect(
			compareYAMLKeys(
				parseDocument(left).contents,
				parseDocument(right).contents
			)
		).toBe(expected);
	}
});

test('compares numeric mapping keys without source text', () => {
	for (const [left, right, expected] of [
		[-0, 0, true],
		[1, 1, true],
		[1, 2, false],
		[1, Number.NaN, false],
		[Number.NaN, Number.NaN, false],
		[Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, true],
	] as const) {
		expect(compareYAMLKeys(new Scalar(left), new Scalar(right))).toBe(
			expected
		);
	}
});

test('compares numeric mapping keys with source text on one side', () => {
	for (const [source, value] of [
		['0', -0],
		['1.0', 1],
		['1e400', Number.POSITIVE_INFINITY],
	] as const) {
		const sourced = parseDocument(source).contents;
		const unsourced = new Scalar(value);

		expect(compareYAMLKeys(sourced, unsourced)).toBe(true);
		expect(compareYAMLKeys(unsourced, sourced)).toBe(true);
		expect(compareYAMLKeys(sourced, new Scalar(2))).toBe(false);
		expect(compareYAMLKeys(new Scalar(2), sourced)).toBe(false);
	}
});

test('matches equivalent numeric mapping keys', () => {
	for (const [left, right] of [
		['!!float "1.0"', '!!int "1"'],
		['+1', '1'],
		['-.INF', '-.inf'],
		['-0', '0'],
		['-0.0', '0e999999999999999999999999'],
		['-1.0', '-10e-1'],
		['.1234567890123456789', '0.1234567890123456789'],
		['.INF', '+.inf'],
		['0.1', '1e-1'],
		['0010', '1e1'],
		['01', '1'],
		['1', '0o1'],
		['1', '0x1'],
		['1.', '1e0'],
		['1.0', '1e0'],
		['1E+2', '100'],
		['1e-400', '10e-401'],
		['1e400', '10e399'],
		['1e9007199254740993', '10e9007199254740992'],
		['9007199254740993', '0x20000000000001'],
	] as const) {
		const leftNode = parseDocument(left).contents;
		const rightNode = parseDocument(right).contents;

		expect(compareYAMLKeys(leftNode, rightNode)).toBe(true);
		expect(compareYAMLKeys(rightNode, leftNode)).toBe(true);
	}
});

test('matches equivalent numeric mapping keys in YAML 1.1 documents', () => {
	for (const [left, right] of [
		['+0b1', '0x1'],
		['-010', '-8'],
		['-0b10', '-2'],
		['-0x1', '-1'],
		['-1:00', '-60'],
		['.1_0', '0.10'],
		['0', '-00'],
		['010', '8'],
		['0b1__0_', '2'],
		['0xA', '10'],
		['1:00', '60'],
		['1:00.1_0', '60.10'],
		['1:00._', '60'],
		['1:02:03.', '3723'],
		['1_0', '10'],
		['9007199254740993:00', '540431955284459580'],
		['9_007_199_254_740_993', '9007199254740993'],
	] as const) {
		const leftNode = parseDocument(left, { version: '1.1' }).contents;
		const rightNode = parseDocument(right, { version: '1.1' }).contents;

		expect(compareYAMLKeys(leftNode, rightNode)).toBe(true);
		expect(compareYAMLKeys(rightNode, leftNode)).toBe(true);
	}
});

test('preserves distinct mapping keys with numeric scalars', () => {
	for (const [left, right] of [
		['"1"', '1'],
		['-.inf', '.inf'],
		['-1e400', '-.inf'],
		['.inf', '1e400'],
		['0', '1e-400'],
		['0.1234567890123456788', '0.1234567890123456789'],
		['1', '"1"'],
		['1e-400', '2e-400'],
		['1e400', '2e400'],
		['1e9007199254740992', '1e9007199254740993'],
		['9007199254740992', '9007199254740993'],
	] as const) {
		const leftNode = parseDocument(left).contents;
		const rightNode = parseDocument(right).contents;

		expect(compareYAMLKeys(leftNode, rightNode)).toBe(false);
		expect(compareYAMLKeys(rightNode, leftNode)).toBe(false);
	}
});

test('preserves distinct numeric mapping keys in YAML 1.1 documents', () => {
	for (const [left, right] of [
		['010', '10'],
		['0400000000000000000', '0400000000000000001'],
		['0:00.1234567890123456788', '0:00.1234567890123456789'],
		['9007199254740992:00', '9007199254740993:00'],
	] as const) {
		const leftNode = parseDocument(left, { version: '1.1' }).contents;
		const rightNode = parseDocument(right, { version: '1.1' }).contents;

		expect(compareYAMLKeys(leftNode, rightNode)).toBe(false);
		expect(compareYAMLKeys(rightNode, leftNode)).toBe(false);
	}
});

test('preserves NaN mapping keys', () => {
	for (const version of ['1.1', '1.2'] as const) {
		for (const [left, right] of [
			['.NAN', '.nan'],
			['.NaN', '.nan'],
			['.nan', '.nan'],
			['.nan', '0'],
			['0', '.nan'],
		] as const) {
			const leftNode = parseDocument(left, { version }).contents;
			const rightNode = parseDocument(right, { version }).contents;

			expect(compareYAMLKeys(leftNode, rightNode)).toBe(false);
			expect(compareYAMLKeys(rightNode, leftNode)).toBe(false);
		}
	}
});

test('preserves YAML 1.1 numeric keys that resolve to NaN', () => {
	for (const key of ['.', '0_', '0b_', '0x_', 'e1']) {
		const left = parseDocument(key, { version: '1.1' }).contents;
		const right = parseDocument('.nan', { version: '1.1' }).contents;

		expect(compareYAMLKeys(left, right)).toBe(false);
		expect(compareYAMLKeys(right, left)).toBe(false);
	}
});

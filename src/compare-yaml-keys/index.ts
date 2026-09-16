import type { Node } from 'yaml';
import { isScalar } from 'yaml';

/**
 * Compares mapping keys using exact numeric sources when available.
 */
export default function compareYAMLKeys(
	left: Node | null,
	right: Node | null
): boolean {
	if (left === right) {
		return true;
	}

	if (!isScalar(left) || !isScalar(right)) {
		return false;
	}

	if (
		typeof left.value === 'number' &&
		typeof right.value === 'number' &&
		!Number.isNaN(left.value) &&
		!Number.isNaN(right.value) &&
		left.source !== undefined &&
		right.source !== undefined
	) {
		return (
			normalizeNumericSource(left.source, left.format) ===
			normalizeNumericSource(right.source, right.format)
		);
	}

	return left.value === right.value;
}

/**
 * Normalizes resolved non-NaN numeric sources for exact comparison without
 * expanding large exponents.
 */
function normalizeNumericSource(source: string, format?: string): string {
	const sign = source.startsWith('-') ? '-' : '';
	const unsignedSource = source
		.replace(/^[-+]/, '')
		.replaceAll('_', '')
		.toLowerCase();

	if (unsignedSource === '.inf') {
		return `${sign}inf`;
	}

	let coefficient: string;
	let exponent = 0n;

	// The YAML schema has already resolved this source as a non-NaN number
	if (format === 'BIN' || format === 'HEX' || format === 'OCT') {
		const prefix = {
			BIN: '0b',
			HEX: '0x',
			OCT: '0o',
		}[format];

		const digits =
			format === 'OCT'
				? unsignedSource.replace(/^0o?/, '')
				: unsignedSource.slice(2);

		coefficient = BigInt(prefix + digits).toString();
	} else if (format === 'TIME') {
		const [integer, fraction = ''] = unsignedSource.split('.');
		const value = integer!
			.split(':')
			.reduce((total, part) => total * 60n + BigInt(part), 0n);

		coefficient = `${value}${fraction}`;
		exponent = -BigInt(fraction.length);
	} else {
		const [mantissa, power = '0'] = unsignedSource.split('e');
		const [integer, fraction = ''] = mantissa!.split('.');

		coefficient = `${integer}${fraction}`;
		exponent = BigInt(power) - BigInt(fraction.length);
	}

	coefficient = coefficient.replace(/^0+/, '');

	if (coefficient === '') {
		return '0';
	}

	const digits = coefficient.replace(/0+$/, '');

	// Keep exponents symbolic so large exponents don’t expand the source
	exponent += BigInt(coefficient.length - digits.length);

	return `${sign}${digits}e${exponent}`;
}

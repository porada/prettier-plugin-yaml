import type { Parser, ParserOptions } from 'prettier';
import type {
	ParserHookName,
	ParseWithCompatibility,
	PluginWithParsers,
	ResolvedPriorParser,
} from '../types/index.d.ts';

const YAML_PARSER_MARKER = Symbol.for('prettier-plugin-yaml.parser');

type ResolverState = {
	parserByPluginIndex: Map<number, Promise<Parser>>;
	plugins: ParserOptions['plugins'];
	priorParserByHook: Map<
		ParserHookName,
		Promise<ResolvedPriorParser | undefined>
	>;
};

export function markParserAsYAML(parser: Parser): Parser {
	Object.defineProperty(parser, YAML_PARSER_MARKER, { value: true });
	return parser;
}

function isYAMLParser(parser: Parser): boolean {
	return (
		Object.getOwnPropertyDescriptor(parser, YAML_PARSER_MARKER)?.value ===
		true
	);
}

export function callParserWithCompatibility(
	parser: Parser,
	text: string,
	options: ParserOptions
): unknown {
	const parse = parser.parse as ParseWithCompatibility;
	return parse.call(parser, text, options, options);
}

export function createPriorParserResolver(
	expectedAstFormat: string,
	currentParser: Parser
): (
	options: ParserOptions,
	hook: ParserHookName
) => Promise<ResolvedPriorParser | undefined> {
	const resolverStateByOptions = new WeakMap<
		ParserOptions,
		WeakMap<ParserOptions['plugins'], ResolverState>
	>();

	return async (options, hook) => {
		let resolverStateByPlugins = resolverStateByOptions.get(options);

		if (!resolverStateByPlugins) {
			resolverStateByPlugins = new WeakMap();
			resolverStateByOptions.set(options, resolverStateByPlugins);
		}

		let state = resolverStateByPlugins.get(options.plugins);

		if (!state) {
			state = {
				parserByPluginIndex: new Map(),
				plugins: options.plugins,
				priorParserByHook: new Map(),
			};
			resolverStateByPlugins.set(options.plugins, state);
		}

		const cachedParser = state.priorParserByHook.get(hook);

		if (cachedParser) {
			const resolvedParser = await cachedParser;
			return resolvedParser;
		}

		const parser = findPriorParser(
			state,
			hook,
			currentParser,
			expectedAstFormat
		);
		state.priorParserByHook.set(hook, parser);

		const resolvedParser = await parser;
		return resolvedParser;
	};
}

async function findPriorParser(
	state: ResolverState,
	hook: ParserHookName,
	currentParser: Parser,
	expectedAstFormat: string
): Promise<ResolvedPriorParser | undefined> {
	const omittedPluginIndexes = new Set<number>();

	for (let index = state.plugins.length - 1; index >= 0; index -= 1) {
		const plugin = state.plugins[index];

		if (!hasParsers(plugin) || !Object.hasOwn(plugin.parsers, 'yaml')) {
			continue;
		}

		const parserOrInitializer = plugin.parsers.yaml;

		if (!parserOrInitializer) {
			continue;
		}

		const parser = await resolveParser(state, index, parserOrInitializer);

		if (isYAMLParser(parser)) {
			omittedPluginIndexes.add(index);
			continue;
		}

		const parserHook = parser[hook];

		if (parserHook === currentParser[hook]) {
			omittedPluginIndexes.add(index);
			continue;
		}

		if (hook === 'preprocess' && typeof parserHook !== 'function') {
			return undefined;
		}

		assertCompatibleParser(parser, expectedAstFormat);

		return {
			parser,
			plugins: state.plugins.filter(
				(_, index) => !omittedPluginIndexes.has(index)
			),
		};
	}

	return undefined;
}

async function resolveParser(
	state: ResolverState,
	index: number,
	parserOrInitializer: PluginWithParsers['parsers']['yaml']
): Promise<Parser> {
	const cachedParser = state.parserByPluginIndex.get(index);

	if (cachedParser) {
		const resolvedParser = await cachedParser;
		return resolvedParser;
	}

	const parser = initializeParser(parserOrInitializer);
	state.parserByPluginIndex.set(index, parser);

	const resolvedParser = await parser;
	return resolvedParser;
}

async function initializeParser(
	parserOrInitializer: PluginWithParsers['parsers']['yaml']
): Promise<Parser> {
	if (typeof parserOrInitializer === 'function') {
		const parser = await parserOrInitializer();
		return parser;
	}

	return parserOrInitializer;
}

function assertCompatibleParser(
	parser: Parser,
	expectedAstFormat: string
): void {
	if (parser.astFormat !== expectedAstFormat) {
		throw new TypeError(
			`prettier-plugin-yaml cannot compose with the \`yaml\` parser because it uses the \`${parser.astFormat}\` AST format instead of \`${expectedAstFormat}\`.`
		);
	}
}

function hasParsers(plugin: unknown): plugin is PluginWithParsers {
	if (!plugin || typeof plugin !== 'object') {
		return false;
	}

	const { parsers } = plugin as { parsers?: unknown };
	return typeof parsers === 'object' && parsers !== null;
}

export async function withPriorParserOptions<T>(
	options: ParserOptions,
	priorParser: ResolvedPriorParser,
	callback: (options: ParserOptions) => T
): Promise<Awaited<T>> {
	const { astFormat, locEnd, locStart, plugins } = options;
	options.astFormat = priorParser.parser.astFormat;
	options.locEnd = priorParser.parser.locEnd;
	options.locStart = priorParser.parser.locStart;
	options.plugins = priorParser.plugins;

	try {
		return await callback(options);
	} finally {
		options.astFormat = astFormat;
		options.locEnd = locEnd;
		options.locStart = locStart;
		options.plugins = plugins;
	}
}

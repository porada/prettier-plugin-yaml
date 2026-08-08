import type { Parser, ParserOptions } from 'prettier';
import type {
	ParserHookName,
	ParseWithCompatibility,
	PluginWithParsers,
	ResolvedPriorParser,
} from '../types/index.d.ts';

const YAML_PARSER_MARKER = Symbol.for('prettier-plugin-yaml.parser');

type ResolverState = {
	locationState: ResolvedPriorParser['locationState'];
	name: string;
	parserByPluginIndex: Map<number, Promise<Parser>>;
	plugins: ParserOptions['plugins'];
	priorParserByHook: Map<
		ParserHookName,
		Promise<ResolvedPriorParser | undefined>
	>;
};

/**
 * Marks a parser so resolver chains can recognize this plugin’s wrappers.
 */
export function markParserAsYAML(parser: Parser): Parser {
	Object.defineProperty(parser, YAML_PARSER_MARKER, { value: true });
	return parser;
}

/**
 * Checks whether a parser carries this plugin’s marker directly
 * or through inheritance.
 */
function isYAMLParser(parser: Parser): boolean {
	return Reflect.get(parser, YAML_PARSER_MARKER) === true;
}

/**
 * Invokes a parser with options available through both Prettier’s current
 * two-argument and legacy three-argument parse signatures.
 */
export function callParserWithCompatibility(
	parser: Parser,
	text: string,
	options: ParserOptions
): unknown {
	const parse = parser.parse as ParseWithCompatibility;
	return parse.call(parser, text, options, options);
}

/**
 * Creates a resolver that finds and caches the prior compatible parser.
 */
export function createPriorParserResolver(
	expectedAstFormat: string,
	currentParser: Parser
): (
	options: ParserOptions,
	hook: ParserHookName
) => Promise<ResolvedPriorParser | undefined> {
	const resolverStateByOptions = new WeakMap<ParserOptions, ResolverState>();

	return async (options, hook) => {
		let state = resolverStateByOptions.get(options);

		if (!state) {
			state = {
				locationState: {},
				name:
					typeof options.parser === 'string'
						? options.parser
						: 'yaml',
				parserByPluginIndex: new Map(),
				plugins: options.plugins,
				priorParserByHook: new Map(),
			};
			resolverStateByOptions.set(options, state);
		}

		const cachedParser = state.priorParserByHook.get(hook);

		if (cachedParser) {
			const resolvedParser = await cachedParser;
			return resolvedParser;
		}

		const parser = findPriorParser(
			state,
			state.name,
			hook,
			currentParser,
			expectedAstFormat
		);

		state.priorParserByHook.set(hook, parser);

		const resolvedParser = await parser;
		return resolvedParser;
	};
}

/**
 * Finds the nearest prior compatible parser with a distinct implementation
 * of the requested hook.
 */
async function findPriorParser(
	state: ResolverState,
	name: string,
	hook: ParserHookName,
	currentParser: Parser,
	expectedAstFormat: string
): Promise<ResolvedPriorParser | undefined> {
	const omittedPluginIndexes = new Set<number>();

	for (let index = state.plugins.length - 1; index >= 0; index -= 1) {
		const plugin = state.plugins[index];

		if (!hasParsers(plugin) || !Object.hasOwn(plugin.parsers, name)) {
			continue;
		}

		const parserOrInitializer = plugin.parsers[name];

		if (!parserOrInitializer) {
			continue;
		}

		const parser = await resolveParser(state, index, parserOrInitializer);

		if (isYAMLParser(parser)) {
			omittedPluginIndexes.add(index);
			continue;
		}

		assertCompatibleParser(name, parser, expectedAstFormat);

		const parserHook = parser[hook];

		if (parserHook === currentParser[hook]) {
			omittedPluginIndexes.add(index);
			continue;
		}

		if (hook === 'preprocess' && typeof parserHook !== 'function') {
			return undefined;
		}

		return {
			locationState: state.locationState,
			parser,
			plugins: state.plugins.filter(
				(_, index) => !omittedPluginIndexes.has(index)
			),
		};
	}

	return undefined;
}

/**
 * Resolves and caches a parser or initializer by plugin index.
 */
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

/**
 * Returns a direct parser or initializes a lazy parser.
 */
async function initializeParser(
	parserOrInitializer: PluginWithParsers['parsers']['yaml']
): Promise<Parser> {
	if (typeof parserOrInitializer === 'function') {
		const parser = await parserOrInitializer();
		return parser;
	}

	return parserOrInitializer;
}

/**
 * Throws when a parser’s AST format is incompatible with this plugin.
 */
function assertCompatibleParser(
	name: string,
	parser: Parser,
	expectedAstFormat: string
): void {
	if (parser.astFormat !== expectedAstFormat) {
		throw new TypeError(
			`[prettier-plugin-yaml] Unsupported AST format for the \`${name}\` parser. Expected \`${expectedAstFormat}\`, received \`${parser.astFormat}\``
		);
	}
}

/**
 * Checks whether a value exposes a parser map.
 */
function hasParsers(plugin: unknown): plugin is PluginWithParsers {
	if (!plugin || typeof plugin !== 'object') {
		return false;
	}

	const { parsers } = plugin as { parsers?: unknown };
	return typeof parsers === 'object' && parsers !== null;
}

/**
 * Invokes a callback with options configured for the prior parser.
 */
export async function withPriorParserOptions<T>(
	options: ParserOptions,
	priorParser: ResolvedPriorParser,
	callback: (options: ParserOptions) => T
): Promise<Awaited<T>> {
	const { astFormat, locEnd, locStart, plugins } = options;

	const delegatedLocEnd =
		priorParser.locationState.locEnd ?? priorParser.parser.locEnd;
	const delegatedLocStart =
		priorParser.locationState.locStart ?? priorParser.parser.locStart;
	const delegatedPlugins = priorParser.plugins;

	options.astFormat = priorParser.parser.astFormat;
	options.locEnd = delegatedLocEnd;
	options.locStart = delegatedLocStart;
	options.plugins = delegatedPlugins;

	try {
		return await callback(options);
	} finally {
		if (options.locEnd !== delegatedLocEnd) {
			priorParser.locationState.locEnd = options.locEnd;
		}

		if (options.locStart !== delegatedLocStart) {
			priorParser.locationState.locStart = options.locStart;
		}

		options.astFormat = astFormat;
		options.locEnd = priorParser.locationState.locEnd ?? locEnd;
		options.locStart = priorParser.locationState.locStart ?? locStart;

		if (options.plugins === delegatedPlugins) {
			options.plugins = plugins;
		}
	}
}

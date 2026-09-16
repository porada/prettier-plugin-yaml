import type { Parser, ParserOptions } from 'prettier';
import type {
	ParserDelegation,
	ParserHookName,
	ParseWithCompatibility,
	PluginWithParsers,
	ResolvedPriorParser,
} from '../types/index.d.ts';

const YAML_PARSER_DELEGATION = Symbol.for(
	'prettier-plugin-yaml.parser-delegation'
);
const YAML_PARSER_MARKER = Symbol.for('prettier-plugin-yaml.parser');
const YAML_PARSER_ORIGIN = Symbol.for('prettier-plugin-yaml.parser-origin');

type ParserDelegationContext = {
	delegation?: ParserDelegation;
	snapshot: Pick<ParserOptions, 'locEnd' | 'locStart' | 'plugins'>;
	syncOptions: () => void;
};

type ParserOptionsWithDelegation = ParserOptions & {
	[YAML_PARSER_DELEGATION]?: ParserDelegationContext;
};

type ParserOrigin = Pick<Parser, 'parse' | 'preprocess'>;

type ResolverState = {
	entryOptions: NonNullable<ResolvedPriorParser['entryOptions']>;
	lifecycleState: ResolvedPriorParser['lifecycleState'];
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
	Object.defineProperty(parser, YAML_PARSER_ORIGIN, {
		enumerable: true,
		value: {
			parse: parser.parse,
			preprocess: parser.preprocess,
		} satisfies ParserOrigin,
	});
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
		const context = (options as ParserOptionsWithDelegation)[
			YAML_PARSER_DELEGATION
		];
		const delegation = getParserDelegation(options, hook);

		if (delegation) {
			return delegation.resolveNext();
		}

		let state = resolverStateByOptions.get(options);

		if (!state) {
			state = {
				entryOptions: {
					locEnd: currentParser.locEnd,
					locStart: currentParser.locStart,
					plugins: options.plugins,
				},
				lifecycleState: {},
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

		if (!context) {
			const { entryOptions, lifecycleState } = state;

			if (options.locEnd !== entryOptions.locEnd) {
				lifecycleState.locEnd = options.locEnd;
			}

			if (options.locStart !== entryOptions.locStart) {
				lifecycleState.locStart = options.locStart;
			}

			if (options.plugins !== entryOptions.plugins) {
				lifecycleState.plugins = options.plugins;
			}

			entryOptions.locEnd = options.locEnd;
			entryOptions.locStart = options.locStart;
			entryOptions.plugins = options.plugins;
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

/**
 * Finds the nearest prior compatible parser with a distinct implementation
 * of the requested hook.
 */
async function findPriorParser(
	state: ResolverState,
	hook: ParserHookName,
	currentParser: Parser,
	expectedAstFormat: string,
	beforeIndex = state.plugins.length,
	omittedPluginIndexes = new Set<number>(),
	rootEntry = true
): Promise<ResolvedPriorParser | undefined> {
	const { name } = state;
	let isEntry = rootEntry;

	for (let index = beforeIndex - 1; index >= 0; index -= 1) {
		const plugin = state.plugins[index];

		if (!hasParsers(plugin) || !Object.hasOwn(plugin.parsers, name)) {
			continue;
		}

		const parserOrInitializer = plugin.parsers[name];

		if (!parserOrInitializer) {
			continue;
		}

		const parser = await resolveParser(state, index, parserOrInitializer);
		const isSelectedParser = isEntry;
		isEntry = false;

		if (isYAMLParser(parser)) {
			omittedPluginIndexes.add(index);
			continue;
		}

		assertCompatibleParser(name, parser, expectedAstFormat);

		const parserHook = parser[hook];
		const origin = Reflect.get(parser, YAML_PARSER_ORIGIN) as
			ParserOrigin | undefined;

		// Treat the selected copied wrapper as entered, even for lazy parsers
		// This assumes the plugin list has not changed before first entry
		if (
			(isSelectedParser && origin !== undefined) ||
			parserHook === currentParser[hook] ||
			(origin !== undefined && parserHook === origin[hook])
		) {
			omittedPluginIndexes.add(index);
			continue;
		}

		if (hook === 'preprocess' && typeof parserHook !== 'function') {
			return undefined;
		}

		const omittedPlugins = new Set(
			[...omittedPluginIndexes].map(
				(omittedIndex) => state.plugins[omittedIndex]
			)
		);
		let nextParser: Promise<ResolvedPriorParser | undefined> | undefined;

		return {
			delegation: {
				hook,
				parserName: 'yaml',
				resolveNext: async () => {
					nextParser ??= findPriorParser(
						state,
						hook,
						currentParser,
						expectedAstFormat,
						index,
						new Set([...omittedPluginIndexes, index]),
						false
					);
					const resolvedNextParser = await nextParser;
					return resolvedNextParser;
				},
			},
			entryOptions: state.entryOptions,
			lifecycleState: state.lifecycleState,
			parser,
			get plugins() {
				const plugins = state.lifecycleState.plugins ?? state.plugins;
				return plugins.some((plugin) => omittedPlugins.has(plugin))
					? plugins.filter((plugin) => !omittedPlugins.has(plugin))
					: plugins;
			},
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
	const parserOptions = options as ParserOptionsWithDelegation;
	const previousDelegation = parserOptions[YAML_PARSER_DELEGATION];
	previousDelegation?.syncOptions();

	const { entryOptions, lifecycleState } = priorParser;
	const delegatedLocEnd = lifecycleState.locEnd ?? priorParser.parser.locEnd;
	const delegatedLocStart =
		lifecycleState.locStart ?? priorParser.parser.locStart;
	const delegatedPlugins = priorParser.plugins;

	options.astFormat = priorParser.parser.astFormat;
	options.locEnd = delegatedLocEnd;
	options.locStart = delegatedLocStart;
	options.plugins = delegatedPlugins;

	const context: ParserDelegationContext = {
		delegation: priorParser.delegation,
		snapshot: {
			locEnd: delegatedLocEnd,
			locStart: delegatedLocStart,
			plugins: delegatedPlugins,
		},
		syncOptions: () => {
			if (options.locEnd !== context.snapshot.locEnd) {
				lifecycleState.locEnd = options.locEnd;
			}

			if (options.locStart !== context.snapshot.locStart) {
				lifecycleState.locStart = options.locStart;
			}

			if (options.plugins !== context.snapshot.plugins) {
				lifecycleState.plugins = options.plugins;
			}

			context.snapshot = {
				locEnd: options.locEnd,
				locStart: options.locStart,
				plugins: options.plugins,
			};
		},
	};
	parserOptions[YAML_PARSER_DELEGATION] = context;

	let parsedLocations: Pick<ParserOptions, 'locEnd' | 'locStart'> | undefined;

	try {
		const result = await callback(options);

		if (priorParser.delegation?.hook === 'parse') {
			parsedLocations = {
				locEnd: options.locEnd,
				locStart: options.locStart,
			};
		}

		return result;
	} finally {
		context.syncOptions();

		options.astFormat = astFormat;
		options.locEnd =
			lifecycleState.locEnd ?? parsedLocations?.locEnd ?? locEnd;
		options.locStart =
			lifecycleState.locStart ?? parsedLocations?.locStart ?? locStart;

		if (options.plugins === delegatedPlugins) {
			options.plugins = plugins;
		}

		if (previousDelegation) {
			// Nested AST handoff is not an explicit write by the outer hook
			previousDelegation.snapshot = {
				locEnd: options.locEnd,
				locStart: options.locStart,
				plugins: options.plugins,
			};
			parserOptions[YAML_PARSER_DELEGATION] = previousDelegation;
		} else {
			if (entryOptions) {
				entryOptions.locEnd = options.locEnd;
				entryOptions.locStart = options.locStart;
				entryOptions.plugins = options.plugins;
			}

			Reflect.deleteProperty(parserOptions, YAML_PARSER_DELEGATION);
		}
	}
}

/**
 * Returns the active continuation for the requested YAML parser hook.
 */
export function getParserDelegation(
	options: ParserOptions,
	hook: ParserHookName
): ParserDelegation | undefined {
	const delegation = (options as ParserOptionsWithDelegation)[
		YAML_PARSER_DELEGATION
	]?.delegation;
	return delegation?.hook === hook && delegation.parserName === 'yaml'
		? delegation
		: undefined;
}

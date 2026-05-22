<p align="center">
    <a href="https://github.com/porada/prettier-plugin-yaml">
        <picture>
            <source
                srcset="https://github.com/porada/prettier-plugin-yaml/blob/main/.github/assets/prettier-plugin-yaml-dark-scheme@3x.png?raw=true"
                media="(prefers-color-scheme: dark)"
            />
            <source
                srcset="https://github.com/porada/prettier-plugin-yaml/blob/main/.github/assets/prettier-plugin-yaml-light-scheme@3x.png?raw=true"
                media="(prefers-color-scheme: light)"
            />
            <img
                src="https://github.com/porada/prettier-plugin-yaml/blob/main/.github/assets/prettier-plugin-yaml-light-scheme@3x.png?raw=true"
                width="520"
                alt=""
            />
        </picture>
    </a>
</p>

<h1 align="center">prettier-plugin-yaml</h1>

<p align="center">Additional YAML formatting options for&nbsp;Prettier.</p>

<p align="center">
    <a href="https://npmx.dev/package/prettier-plugin-yaml"
        ><img
            src="https://img.shields.io/npm/v/prettier-plugin-yaml?style=flat-square"
            alt=""
    /></a>
    <a href="https://github.com/porada/prettier-plugin-yaml/actions/workflows/test.yaml"
        ><img
            src="https://img.shields.io/github/actions/workflow/status/porada/prettier-plugin-yaml/test.yaml?style=flat-square"
            alt=""
    /></a>
    <a href="https://codecov.io/github/porada/prettier-plugin-yaml"
        ><img
            src="https://img.shields.io/codecov/c/github/porada/prettier-plugin-yaml?style=flat-square"
            alt=""
    /></a>
</p>

<div>&nbsp;</div>

## Install

```sh
npm install --save-dev prettier-plugin-yaml
```

```sh
pnpm add --save-dev prettier-plugin-yaml
```

## Usage

Reference `prettier-plugin-yaml` in your [Prettier config](https://prettier.io/docs/configuration):

```json
{
    "plugins": [
        "prettier-plugin-yaml"
    ]
}
```

If you’re using any other YAML plugins, make sure `prettier-plugin-yaml` is listed last.

## Options

In addition to Prettier’s [built-in options](https://prettier.io/docs/options) that affect YAML formatting, `prettier-plugin-yaml` offers additional configuration options.

```ts
interface PluginOptions {
    /**
     * Enforce a single block style for multi-line string values.
     */
    yamlBlockStyle?: 'folded' | 'literal' | undefined;
    /**
     * Enforce a single collection style for maps and sequences.
     */
    yamlCollectionStyle?: 'block' | 'flow' | undefined;
    /**
     * Quote all mapping keys. Removes unnecessary quotes when disabled.
     * @default false
     */
    yamlQuoteKeys?: boolean | undefined;
    /**
     * Quote keys that match a specific pattern. Non-string keys are matched
     * based on their string representation. Doesn’t affect mapping keys that
     * must be quoted anyway.
     */
    yamlQuoteKeysMatching?: string | undefined;
    /**
     * Quote all string values. Removes unnecessary quotes when disabled.
     * @default false
     */
    yamlQuoteValues?: boolean | undefined;
    /**
     * Quote values that match a specific pattern. Non-string values are matched
     * based on their string representation. Doesn’t affect values that must be
     * quoted anyway.
     */
    yamlQuoteValuesMatching?: string | undefined;
}
```

## FAQ

### How do I automatically quote integer values?

Use `yamlQuoteValuesMatching`. Unlike `yamlQuoteValues`, which only applies to string values, `yamlQuoteValuesMatching` matches all values based on their string representation. For example, to quote integers:

```json
{
    "yamlQuoteValuesMatching": "^\\d+$"
}
```

You can quote boolean and `null` values similarly:

```json
{
    "yamlQuoteValuesMatching": "^(true|false|null)$"
}
```

To quote mapping keys, use `yamlQuoteKeys` and `yamlQuoteKeysMatching`.

### Why do `yamlQuoteValuesMatching` and `yamlQuoteKeysMatching` accept strings instead of regular expressions?

This comes from a limitation in how Prettier handles configuration values. `RegExp` is not a supported type, so the pattern must be provided as a string.

Internally, the plugin applies patterns as `new RegExp(pattern)` without flags. Remember to escape backslashes and other special characters accordingly.

## Related

- [**@standard-config/prettier**](https://github.com/standard-config/prettier)
- [**prettier-plugin-expand-json**](https://github.com/porada/prettier-plugin-expand-json)
- [**prettier-plugin-markdown-html**](https://github.com/porada/prettier-plugin-markdown-html)

## License

MIT © [Dom Porada](https://dom.engineering)

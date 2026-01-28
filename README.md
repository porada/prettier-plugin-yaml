<p align="center">
    <a href="https://github.com/porada/prettier-plugin-yaml">
        <picture>
            <source srcset="assets/prettier-plugin-yaml@3x.png" media="(prefers-color-scheme: light)" />
            <img src="assets/prettier-plugin-yaml@3x.png" width="520" alt="" />
        </picture>
    </a>
</p>

<h1 align="center">
    prettier-plugin-yaml
</h1>

<p align="center">
    Additional YAML formatting options for&nbsp;Prettier.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/prettier-plugin-yaml"><img src="https://img.shields.io/npm/v/prettier-plugin-yaml" alt="" /></a>
    <a href="https://github.com/porada/prettier-plugin-yaml/actions/workflows/test.yaml"><img src="https://img.shields.io/github/actions/workflow/status/porada/prettier-plugin-yaml/test.yaml" alt="" /></a>
    <a href="https://codecov.io/github/porada/prettier-plugin-yaml"><img src="https://img.shields.io/codecov/c/github/porada/prettier-plugin-yaml" alt="" /></a>
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
     * Quote all string values. Removes unnecessary quotes when disabled.
     * @default false
     */
    yamlQuoteValues?: boolean | undefined;
}
```

## Related

- [**@standard-config/prettier**](https://github.com/standard-config/prettier)
- [**prettier-plugin-expand-json**](https://github.com/porada/prettier-plugin-expand-json)

## License

MIT © [Dom Porada](https://dom.engineering)

[![](https://img.shields.io/npm/v/prettier-plugin-yaml)](https://www.npmjs.com/package/prettier-plugin-yaml)
[![](https://img.shields.io/github/actions/workflow/status/porada/prettier-plugin-yaml/test.yaml)](https://github.com/porada/prettier-plugin-yaml/actions/workflows/test.yaml)
[![](https://img.shields.io/codecov/c/github/porada/prettier-plugin-yaml)](https://codecov.io/github/porada/prettier-plugin-yaml)

# prettier-plugin-yaml

Format YAML files with Prettier, extended with additional formatting options.

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

## Related

- [**@standard-config/prettier**](https://github.com/standard-config/prettier)
- [**prettier-plugin-expand-json**](https://github.com/porada/prettier-plugin-expand-json)

## License

MIT © [Dom Porada](https://dom.engineering)

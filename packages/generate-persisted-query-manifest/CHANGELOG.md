# @apollo/generate-persisted-query-manifest

## 1.0.0-alpha.5

### Patch Changes

- [#302](https://github.com/apollographql/apollo-utils/pull/302) [`3057433`](https://github.com/apollographql/apollo-utils/commit/30574331ef2ab3215d6c0c0d77aee81f29bafc84) Thanks [@jerelmiller](https://github.com/jerelmiller)! - Provides more robust error handling and reporting.

  - Collect all errors while generating manifest and report them together at once. Previously it would exit as soon as an error was encountered, even if there were multiple issues.
  - Update the error reporting format to make it much easier to determine which file contains the error.

## 1.0.0-alpha.4

### Patch Changes

- [#295](https://github.com/apollographql/apollo-utils/pull/295) [`c41dd06`](https://github.com/apollographql/apollo-utils/commit/c41dd06ccb0d4b89c12a9458e9cb76ccc3cb4150) Thanks [@jerelmiller](https://github.com/jerelmiller)! - Adds support for a config file to the CLI. This can be used to determine where the CLI should look for GraphQL operations and where the manifest file should be written. The CLI has the ability to specify the path to the config file.

## 1.0.0-alpha.3

### Patch Changes

- [#287](https://github.com/apollographql/apollo-utils/pull/287) [`fb4f6da`](https://github.com/apollographql/apollo-utils/commit/fb4f6da57acf48ba6eba90011a42d8a9397f6649) Thanks [@glasser](https://github.com/glasser)! - Change `generatePersistedQueryIdsFromManifest` to take an async `loadManifest`. Ensure Promises don't have unhandled rejections.

- Updated dependencies [[`fb4f6da`](https://github.com/apollographql/apollo-utils/commit/fb4f6da57acf48ba6eba90011a42d8a9397f6649)]:
  - @apollo/persisted-query-lists@1.0.0-alpha.3

## 1.0.0-alpha.2

### Patch Changes

- [#293](https://github.com/apollographql/apollo-utils/pull/293) [`bef53e4`](https://github.com/apollographql/apollo-utils/commit/bef53e4cfc173eefff3b773335002627aaebc35b) Thanks [@jerelmiller](https://github.com/jerelmiller)! - Add `@apollo/persisted-query-lists` as a dependency to fix missing dependency issue.

- [#291](https://github.com/apollographql/apollo-utils/pull/291) [`f72c2d0`](https://github.com/apollographql/apollo-utils/commit/f72c2d08da2e14d477e9c8528d47c2f219554537) Thanks [@jerelmiller](https://github.com/jerelmiller)! - Allow v3.8.0 prerelease versions of @apollo/client.

- Updated dependencies [[`f72c2d0`](https://github.com/apollographql/apollo-utils/commit/f72c2d08da2e14d477e9c8528d47c2f219554537)]:
  - @apollo/persisted-query-lists@1.0.0-alpha.2

## 1.0.0-alpha.1

### Patch Changes

- [#287](https://github.com/apollographql/apollo-utils/pull/287) [`9b5c8d9`](https://github.com/apollographql/apollo-utils/commit/9b5c8d92e3f47b43c32b4b014428c49cc0b38219) Thanks [@glasser](https://github.com/glasser)! - Change createPersistedQueryManifestVerificationLink to load manifest asynchronously.

## 1.0.0-alpha.0

### Major Changes

- [#287](https://github.com/apollographql/apollo-utils/pull/287) [`f4a710d`](https://github.com/apollographql/apollo-utils/commit/f4a710dbe22bf1b579299e1438ac6cb45ec912ab) Thanks [@glasser](https://github.com/glasser)! - Initial release
import { createFragmentRegistry } from "@apollo/client/cache";
import type { FragmentRegistryAPI } from "@apollo/client/cache";
import semver from "semver";
import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  Observable,
} from "@apollo/client/core";
import type {
  ApolloClientOptions,
  // @ts-ignore
  DocumentTransform as RealDocumentTransform,
} from "@apollo/client/core";
import { sortTopLevelDefinitions } from "@apollo/persisted-query-lists";
import { gqlPluckFromCodeStringSync } from "@graphql-tools/graphql-tag-pluck";
import globby from "globby";
import {
  type OperationDefinitionNode,
  parse,
  print,
  type DocumentNode,
  visit,
  GraphQLError,
  BREAK,
} from "graphql";
import { first, sortBy } from "lodash";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import vfile from "vfile";
import type { VFile } from "vfile";
import reporter from "vfile-reporter";
import chalk from "chalk";

type OperationType = "query" | "mutation" | "subscription";

// If the user uses Apollo Client 3.7, `DocumentTransform` won't exist.
// TypeScript will default the value to `any` in this case. We don't want to
// allow this property in this case, so we set the type to `never`.
type DocumentTransform = any extends RealDocumentTransform
  ? never
  : RealDocumentTransform;

interface CreateOperationIdOptions {
  operationName: string;
  type: OperationType;
  createDefaultId: () => string;
}

export interface PersistedQueryManifestConfig {
  /**
   * Paths to your GraphQL documents: queries, mutations, subscriptions, and fragments.
   * Prefix the pattern with `!` to specify a path that should be ignored.
   */
  documents?: string | string[] | CustomDocumentSourceConfig;

  /**
   * A `DocumentTransform` instance that will be used to transform the GraphQL
   * document before it is saved to the manifest.
   *
   * For more information about document transforms, see the [Document
   * transforms](https://www.apollographql.com/docs/react/data/document-transforms)
   * documentation page.
   *
   * IMPORTANT: You must be running `@apollo/client` 3.8.0 or greater to use
   * this feature.
   *
   * @example
   * ```ts
   * import { DocumentTransform } from "@apollo/client/core";
   *
   * const config = {
   *   documentTransform: new DocumentTransform((document) => {
   *     // ... transform the document
   *
   *     return transformedDocument;
   *   })
   * }
   * ```
   *
   * @since 1.2.0
   */
  documentTransform?: DocumentTransform;

  /**
   * Path where the manifest file will be written.
   */
  output?: string;

  /**
   * Function that generates a manifest operation ID for a given query.
   *
   * Defaults to a sha256 hash of the query.
   */
  createOperationId?: (
    query: string,
    options: CreateOperationIdOptions,
  ) => string;
}

interface DocumentSourceConfig {
  fragmentRegistry?: FragmentRegistryAPI;
  sources: DocumentSource[];
}

interface CustomDocumentSourceConfig {
  [CUSTOM_DOCUMENTS_SOURCE]: () => DocumentSourceConfig;
}

const CUSTOM_DOCUMENTS_SOURCE = Symbol.for(
  "apollo.generate-persisted-query-manifest.documents-source",
);

export interface PersistedQueryManifestOperation {
  id: string;
  name: string;
  type: OperationType;
  body: string;
}

export interface PersistedQueryManifest {
  format: "apollo-persisted-query-manifest";
  version: 1;
  operations: PersistedQueryManifestOperation[];
}

/**
 * Source documents from a persisted documents manifest generated by [GraphQL
 * Codegen](https://the-guild.dev/graphql/codegen). Using this utility skips all file system traversal and uses the
 * documents defined in the persisted documents file.
 *
 * For more information see the [Persisted documents](https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#persisted-documents) documentation.
 *
 * @example
 * ```ts
 * import {
 *   fromGraphQLCodegenPersistedDocuments
 * } from '@apollo/generate-persisted-query-manifest';
 *
 * const config = {
 *   documents: fromGraphQLCodegenPersistedDocuments('./path/to/persisted-documents.json')
 * };
 * ```
 *
 * @since 1.2.0
 */
export function fromGraphQLCodegenPersistedDocuments(
  filepath: string,
): CustomDocumentSourceConfig {
  return {
    [CUSTOM_DOCUMENTS_SOURCE]: () => {
      const file = vfile({ path: filepath });

      function getSourceWithError(message: string): DocumentSource[] {
        addError({ file }, message);

        return [{ file, node: null, location: undefined }];
      }

      if (!existsSync(file.path!)) {
        return {
          sources: getSourceWithError(
            ERROR_MESSAGES.graphqlCodegenManifestFileNotFound(filepath),
          ),
        };
      }

      try {
        const manifest = JSON.parse(readFileSync(filepath, "utf-8"));

        if (isParseableGraphQLCodegenManifest(manifest)) {
          // We don't run any validation on unique entries because we assume
          // GraphQL Codegen has already handled this in the persisted documents
          // generation.
          return {
            sources: Object.values(manifest).map((query) => ({
              file,
              node: parse(query),
              location: undefined,
            })),
          };
        } else {
          return {
            sources: getSourceWithError(
              ERROR_MESSAGES.malformedGraphQLCodegenManifest(),
            ),
          };
        }
      } catch (e) {
        return {
          sources: getSourceWithError(ERROR_MESSAGES.parseError(e as Error)),
        };
      }
    },
  };
}

export const defaults = {
  documents: [
    "src/**/*.{graphql,gql,js,jsx,ts,tsx}",
    "!**/*.d.ts",
    "!**/*.spec.{js,jsx,ts,tsx}",
    "!**/*.story.{js,jsx,ts,tsx}",
    "!**/*.test.{js,jsx,ts,tsx}",
  ],
  output: "persisted-query-manifest.json",
  createOperationId: (query: string) => {
    return createHash("sha256").update(query).digest("hex");
  },
};

interface Location {
  line: number;
  column: number;
}

interface DocumentSource {
  node: DocumentNode | null;
  file: VFile;
  location: Location | undefined;
}

const COLORS = {
  identifier: chalk.magenta,
  filepath: chalk.underline.cyan,
  name: chalk.yellow,
};

const ERROR_MESSAGES = {
  anonymousOperation: (node: OperationDefinitionNode) => {
    return `Anonymous GraphQL operations are not supported. Please name your ${node.operation}.`;
  },
  graphqlCodegenManifestFileNotFound: (filepath: string) => {
    return `ENOENT: GraphQL Codegen persisted documents file not found: '${filepath}'`;
  },
  malformedGraphQLCodegenManifest: () => {
    return "GraphQL Codegen persisted documents manifest is malformed. Either the file was not generated by GraphQL Codegen or the format has been updated and is no longer compatible with this utility.";
  },
  uniqueFragment: (name: string, source: DocumentSource) => {
    return `Fragment named "${COLORS.name(
      name,
    )}" already defined in: ${COLORS.filepath(source.file.path)}`;
  },
  uniqueOperation: (name: string, source: DocumentSource) => {
    return `Operation named "${COLORS.name(
      name,
    )}" already defined in: ${COLORS.filepath(source.file.path)}`;
  },
  uniqueOperationId: (
    id: string,
    operationName: string,
    definedOperationName: string,
  ) => {
    return `\`createOperationId\` created an ID (${COLORS.identifier(
      id,
    )}) for operation named "${COLORS.name(
      operationName,
    )}" that has already been used for operation named "${COLORS.name(
      definedOperationName,
    )}".`;
  },
  parseError(error: Error) {
    return formatErrorMessage(error);
  },
  multipleOperations() {
    return "Cannot declare multiple operations in a single document.";
  },
};

async function enableDevMessages() {
  const { loadDevMessages, loadErrorMessages } = await import(
    "@apollo/client/dev"
  );

  loadDevMessages();
  loadErrorMessages();
}

function addError(
  source: Pick<DocumentSource, "file"> & Partial<DocumentSource>,
  message: string,
) {
  const vfileMessage = source.file.message(message, source.location);
  vfileMessage.fatal = true;
}

function isCustomDocumentsSource(
  documentsConfig: unknown,
): documentsConfig is CustomDocumentSourceConfig {
  return (
    typeof documentsConfig === "object" &&
    documentsConfig !== null &&
    Object.prototype.hasOwnProperty.call(
      documentsConfig,
      CUSTOM_DOCUMENTS_SOURCE,
    )
  );
}

function isParseableGraphQLCodegenManifest(
  manifest: unknown,
): manifest is Record<string, string> {
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    !Array.isArray(manifest) &&
    Object.entries(manifest).every(
      ([key, value]) => typeof key === "string" && typeof value === "string",
    )
  );
}

function parseLocationFromError(error: Error) {
  if (error instanceof GraphQLError && error.locations) {
    return error.locations[0];
  }

  const loc =
    "loc" in error &&
    typeof error.loc === "object" &&
    error.loc !== null &&
    error.loc;

  const line = loc && "line" in loc && typeof loc.line === "number" && loc.line;
  const column =
    loc && "column" in loc && typeof loc.column === "number" && loc.column;

  if (typeof line === "number" && typeof column === "number") {
    return { line, column };
  }

  return;
}

function getDocumentSources(filepath: string): DocumentSource[] {
  const file = vfile({
    path: filepath,
    contents: readFileSync(filepath, "utf-8"),
  });

  try {
    if (file.extname === ".graphql" || file.extname === ".gql") {
      return [
        {
          node: parse(file.toString()),
          file,
          location: { line: 1, column: 1 },
        },
      ];
    }

    return gqlPluckFromCodeStringSync(filepath, file.toString()).map(
      (source) => ({
        node: parse(source.body),
        file,
        location: source.locationOffset,
      }),
    );
  } catch (e: unknown) {
    const error = e as Error;
    const source = {
      node: null,
      file,
      location: parseLocationFromError(error),
    };

    addError(source, ERROR_MESSAGES.parseError(error));

    return [source];
  }
}

function maybeReportErrorsAndExit(files: VFile | VFile[]) {
  if (!Array.isArray(files)) {
    files = [files];
  }

  if (files.some((file) => file.messages.length > 0)) {
    console.error(reporter(files, { quiet: true }));
    process.exit(1);
  }
}

function uniq<T>(arr: T[]) {
  return [...new Set(arr)];
}

function formatErrorMessage(error: Error) {
  return `${error.name}: ${error.message}`;
}

async function fromFilepathList(
  documents: string | string[],
): Promise<DocumentSourceConfig> {
  const filepaths = await getFilepaths(documents);
  const sources = filepaths.flatMap(getDocumentSources);
  const fragmentsByName = new Map<string, DocumentSource[]>();
  const operationsByName = new Map<string, DocumentSource[]>();

  for (const source of sources) {
    if (!source.node) {
      continue;
    }

    let documentCount = 0;

    visit(source.node, {
      FragmentDefinition(node) {
        const name = node.name.value;
        const sources = fragmentsByName.get(name) ?? [];

        if (sources.length) {
          sources.forEach((sibling) => {
            addError(source, ERROR_MESSAGES.uniqueFragment(name, sibling));
            addError(sibling, ERROR_MESSAGES.uniqueFragment(name, source));
          });
        }

        fragmentsByName.set(name, [...sources, source]);

        return false;
      },
      OperationDefinition(node) {
        const name = node.name?.value;

        if (++documentCount > 1) {
          addError(source, ERROR_MESSAGES.multipleOperations());
          return BREAK;
        }

        if (!name) {
          addError(source, ERROR_MESSAGES.anonymousOperation(node));

          return false;
        }

        const sources = operationsByName.get(name) ?? [];

        if (sources.length) {
          sources.forEach((sibling) => {
            addError(source, ERROR_MESSAGES.uniqueOperation(name, sibling));
            addError(sibling, ERROR_MESSAGES.uniqueOperation(name, source));
          });
        }

        operationsByName.set(name, [...sources, source]);

        return false;
      },
    });
  }

  return {
    fragmentRegistry: createFragmentRegistry(
      ...sources.map(({ node }) => node).filter(Boolean),
    ),
    sources,
  };
}

// Unfortunately globby does not guarantee deterministic file sorting so we
// apply some sorting on the files in this function.
//
// https://github.com/sindresorhus/globby/issues/131
/** @internal */
export async function getFilepaths(
  documents: string | string[] | CustomDocumentSourceConfig,
) {
  if (isCustomDocumentsSource(documents)) {
    const { sources } = documents[CUSTOM_DOCUMENTS_SOURCE]();

    return [
      ...new Set(
        sources.filter(({ file }) => file.path).map(({ file }) => file.path!),
      ),
    ];
  }

  return [...uniq(await globby(documents))].sort((a, b) => a.localeCompare(b));
}

/** @internal */
export async function generatePersistedQueryManifest(
  config: PersistedQueryManifestConfig = {},
  configFilePath: string | undefined,
): Promise<PersistedQueryManifest> {
  const {
    documents = defaults.documents,
    createOperationId = defaults.createOperationId,
  } = config;

  const configFile = vfile({
    path: configFilePath
      ? relative(process.cwd(), configFilePath)
      : "<virtual>",
  });

  const { fragmentRegistry, sources } = isCustomDocumentsSource(documents)
    ? documents[CUSTOM_DOCUMENTS_SOURCE]()
    : await fromFilepathList(documents);

  const operationsByName = new Map<string, DocumentSource[]>();

  for (const source of sources) {
    if (!source.node) {
      continue;
    }

    // We delegate validation to the functions that return the document sources.
    // We just need to record the operations here to sort them in the manifest
    // output.
    visit(source.node, {
      OperationDefinition(node) {
        const name = node.name?.value;

        if (!name) {
          return false;
        }

        const sources = operationsByName.get(name) ?? [];

        operationsByName.set(name, [...sources, source]);

        return false;
      },
    });
  }

  maybeReportErrorsAndExit(uniq(sources.map((source) => source.file)));

  // Using createFragmentRegistry means our minimum AC version is 3.7. We can
  // probably go back to 3.2 (original createPersistedQueryLink) if we just
  // reimplement/copy the fragment registry code here.
  const cache = fragmentRegistry
    ? new InMemoryCache({ fragments: fragmentRegistry })
    : new InMemoryCache();
  const manifestOperationIds = new Map<string, string>();
  const manifestOperations: PersistedQueryManifestOperation[] = [];
  const clientConfig: Partial<ApolloClientOptions<any>> = {};

  if (config.documentTransform) {
    clientConfig.documentTransform = config.documentTransform;
  }

  const client = new ApolloClient({
    ...clientConfig,
    cache,
    link: new ApolloLink((operation) => {
      const body = print(sortTopLevelDefinitions(operation.query));
      const name = operation.operationName;
      const type = (
        operation.query.definitions.find(
          (d) => d.kind === "OperationDefinition",
        ) as OperationDefinitionNode
      ).operation;

      const id = createOperationId(body, {
        operationName: name,
        type,
        createDefaultId() {
          return defaults.createOperationId(body);
        },
      });

      // We only need to validate the `id` when using a config file. Without
      // a config file, our default id function will be used which is
      // guaranteed to create unique IDs.
      if (manifestOperationIds.has(id)) {
        addError(
          { file: configFile },
          ERROR_MESSAGES.uniqueOperationId(
            id,
            name,
            manifestOperationIds.get(id)!,
          ),
        );
      } else {
        manifestOperationIds.set(id, name);
      }

      manifestOperations.push({ id, name, type, body });

      return Observable.of({ data: null });
    }),
  });

  if (semver.gte(client.version, "3.8.0")) {
    await enableDevMessages();
  }

  for (const [_, sources] of sortBy([...operationsByName.entries()], first)) {
    for (const source of sources) {
      if (source.node) {
        try {
          await client.query({ query: source.node, fetchPolicy: "no-cache" });
        } catch (error) {
          if (error instanceof Error) {
            addError(source, formatErrorMessage(error));
          } else {
            addError(source, "Unknown error occured. Please file a bug.");
          }
        }
      }
    }
  }

  maybeReportErrorsAndExit(
    uniq(sources.map((source) => source.file).concat(configFile)),
  );

  return {
    format: "apollo-persisted-query-manifest",
    version: 1,
    operations: manifestOperations,
  };
}

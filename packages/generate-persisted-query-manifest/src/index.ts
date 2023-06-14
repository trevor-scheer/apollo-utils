import { createFragmentRegistry } from "@apollo/client/cache";
import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  Observable,
} from "@apollo/client/core";
import { sortTopLevelDefinitions } from "@apollo/persisted-query-lists";
import { gqlPluckFromCodeStringSync } from "@graphql-tools/graphql-tag-pluck";
import { glob } from "glob";
import {
  type OperationDefinitionNode,
  parse,
  print,
  type DocumentNode,
  visit,
} from "graphql";
import { first, sortBy } from "lodash";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import vfile from "vfile";
import type { VFile } from "vfile";
import reporter from "vfile-reporter";
import chalk from "chalk";

type OperationType = "query" | "mutation" | "subscription";

interface CreateOperationIdOptions {
  operationName: string;
  type: OperationType;
  createDefaultId: () => string;
}

export interface PersistedQueryManifestConfig {
  /**
   * Paths to your GraphQL documents: queries, mutations, subscriptions, and fragments.
   */
  documents?: string | string[];

  /**
   * Paths that should be ignored when searching for your GraphQL documents.
   */
  documentIgnorePatterns?: string | string[];

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

export const defaults = {
  documents: "src/**/*.{graphql,gql,js,jsx,ts,tsx}",
  documentIgnorePatterns: [
    "**/*.d.ts",
    "**/*.spec.{js,jsx,ts,tsx}",
    "**/*.story.{js,jsx,ts,tsx}",
    "**/*.test.{js,jsx,ts,tsx}",
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
  node: DocumentNode;
  file: VFile;
  location: Location;
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
};

function addError(source: DocumentSource, message: string) {
  const vfileMessage = source.file.message(message, source.location);
  vfileMessage.fatal = true;
}

function getDocumentSources(filepath: string): DocumentSource[] {
  const file = vfile({
    path: filepath,
    contents: readFileSync(filepath, "utf-8"),
  });

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

export async function generatePersistedQueryManifest(
  config: PersistedQueryManifestConfig = {},
  configFilePath: string | undefined,
): Promise<PersistedQueryManifest> {
  const {
    documents = defaults.documents,
    documentIgnorePatterns = defaults.documentIgnorePatterns,
    createOperationId = defaults.createOperationId,
  } = config;

  const configFile = configFilePath
    ? vfile({ path: relative(process.cwd(), configFilePath) })
    : null;
  const filepaths = await glob(documents, { ignore: documentIgnorePatterns });
  const sources = uniq(filepaths).flatMap(getDocumentSources);

  const fragmentsByName = new Map<string, DocumentSource[]>();
  const operationsByName = new Map<string, DocumentSource[]>();

  for (const source of sources) {
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

  maybeReportErrorsAndExit(uniq(sources.map((source) => source.file)));

  // Using createFragmentRegistry means our minimum AC version is 3.7. We can
  // probably go back to 3.2 (original createPersistedQueryLink) if we just
  // reimplement/copy the fragment registry code here.
  const fragments = createFragmentRegistry(...sources.map(({ node }) => node));
  const manifestOperationIds = new Map<string, string>();

  const manifestOperations: PersistedQueryManifestOperation[] = [];

  const client = new ApolloClient({
    cache: new InMemoryCache({
      fragments,
    }),
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
      if (configFile && manifestOperationIds.has(id)) {
        const message = configFile.message(
          ERROR_MESSAGES.uniqueOperationId(
            id,
            name,
            manifestOperationIds.get(id)!,
          ),
        );
        message.fatal = true;
      } else {
        manifestOperationIds.set(id, name);
      }

      manifestOperations.push({ id, name, type, body });

      return Observable.of({ data: null });
    }),
  });

  for (const [_, sources] of sortBy([...operationsByName.entries()], first)) {
    for (const source of sources) {
      await client.query({ query: source.node, fetchPolicy: "no-cache" });
    }
  }

  if (configFile) {
    maybeReportErrorsAndExit(configFile);
  }

  return {
    format: "apollo-persisted-query-manifest",
    version: 1,
    operations: manifestOperations,
  };
}

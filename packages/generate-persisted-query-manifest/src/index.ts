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
import vfile from "vfile";
import type { VFile } from "vfile";
import reporter from "vfile-reporter";
import chalk from "chalk";

type RequireKeys<T, K extends keyof T> = Required<Pick<T, K>> & Omit<T, K>;

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
}

type DefaultPersistedQueryManifestConfig = RequireKeys<
  PersistedQueryManifestConfig,
  "documents" | "documentIgnorePatterns" | "output"
>;

export interface PersistedQueryManifestOperation {
  id: string;
  name: string;
  type: "query" | "mutation" | "subscription";
  body: string;
}

export interface PersistedQueryManifest {
  format: "apollo-persisted-query-manifest";
  version: 1;
  operations: PersistedQueryManifestOperation[];
}

export const defaults: DefaultPersistedQueryManifestConfig = {
  documents: "src/**/*.{graphql,gql,js,jsx,ts,tsx}",
  documentIgnorePatterns: [
    "**/*.d.ts",
    "**/*.spec.{js,jsx,ts,tsx}",
    "**/*.story.{js,jsx,ts,tsx}",
    "**/*.test.{js,jsx,ts,tsx}",
  ],
  output: "persisted-query-manifest.json",
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

export async function generatePersistedQueryManifest(
  config: PersistedQueryManifestConfig = {},
): Promise<PersistedQueryManifest> {
  const paths = config.documents ?? defaults.documents;
  const ignorePaths =
    config.documentIgnorePatterns ?? defaults.documentIgnorePatterns;

  const filepaths = await glob(paths, { ignore: ignorePaths });
  const sources = [...new Set(filepaths)].flatMap(getDocumentSources);

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

  if (sources.some(({ file }) => file.messages.length > 0)) {
    const files = [...new Set(sources.map((source) => source.file))];

    console.error(reporter(files, { quiet: true }));
    process.exit(1);
  }

  // Using createFragmentRegistry means our minimum AC version is 3.7. We can
  // probably go back to 3.2 (original createPersistedQueryLink) if we just
  // reimplement/copy the fragment registry code here.
  const fragments = createFragmentRegistry(...sources.map(({ node }) => node));

  const manifestOperations: PersistedQueryManifestOperation[] = [];

  const client = new ApolloClient({
    cache: new InMemoryCache({
      fragments,
    }),
    link: new ApolloLink((operation) => {
      const body = print(sortTopLevelDefinitions(operation.query));
      manifestOperations.push({
        id: createHash("sha256").update(body).digest("hex"),
        name: operation.operationName,
        type: (
          operation.query.definitions.find(
            (d) => d.kind === "OperationDefinition",
          ) as OperationDefinitionNode
        ).operation,
        body,
      });

      return Observable.of({ data: null });
    }),
  });

  for (const [_, sources] of sortBy([...operationsByName.entries()], first)) {
    for (const source of sources) {
      await client.query({ query: source.node, fetchPolicy: "no-cache" });
    }
  }

  return {
    format: "apollo-persisted-query-manifest",
    version: 1,
    operations: manifestOperations,
  };
}
#!/usr/bin/env node

const { Command } = require("commander");
const { cosmiconfig } = require("cosmiconfig");
const { generatePersistedQueryManifest, defaults } = require("./dist/index.js");
const { TypeScriptLoader } = require("cosmiconfig-typescript-loader");
const { version } = require("./package.json");

const program = new Command();

const moduleName = "persisted-query-manifest";
const supportedExtensions = ["json", "yml", "yaml", "js", "ts", "cjs"];

const searchPlaces = supportedExtensions.flatMap((extension) => [
  `.${moduleName}.config.${extension}`,
  `${moduleName}.config.${extension}`,
]);

const explorer = cosmiconfig(moduleName, {
  searchPlaces: searchPlaces.concat("package.json"),
  loaders: {
    ".ts": TypeScriptLoader(),
  },
});

async function getUserConfig({ config: configPath }) {
  return configPath ? explorer.load(configPath) : explorer.search();
}

program
  .name("generate-persisted-query-manifest")
  .description("Generate a persisted query manifest file")
  .option("-c, --config <path>", "path to the config file")
  .version(version, "-v, --version")
  .action(async (cliOptions) => {
    const result = await getUserConfig(cliOptions);
    const outputPath = result?.config.output ?? defaults.output;

    await generatePersistedQueryManifest(result?.config);
    console.log(`Written to ${outputPath}`);
  });

program.parse();

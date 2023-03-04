import { defaults } from 'jest-config';

export default {
  testEnvironment: "node",
  preset: "ts-jest",
  testMatch: null,
  testRegex: "/__tests__/.*\\.test\\.(js|ts)$",
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  moduleFileExtensions: [...defaults.moduleFileExtensions, "ts", "tsx"],
  clearMocks: true,
  transform: {
    "^.+\\.test.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/src/__tests__/tsconfig.json",
        diagnostics: true,
      },
    ],
  },
  moduleNameMapper: {
    // Ignore '.js' at the end of imports; part of ESM support.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};


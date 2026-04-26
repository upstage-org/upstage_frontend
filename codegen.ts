import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * GraphQL Codegen scaffolding.
 *
 * - Set GRAPHQL_SCHEMA_URL (e.g. http://localhost/api/studio_graphql) before
 *   running `pnpm codegen`. For offline use, drop a copy of the SDL at
 *   `schema.graphql` and the loader will pick it up.
 * - Generated artifacts land in `src/services/graphql/__generated__` and are
 *   excluded from lint, prettier, and type coverage exclude lists.
 *
 * Generated types use TypedDocumentNode so existing call sites that use
 * `apolloClient.query({ query: TypedDoc, variables })` get full type inference
 * without changing the runtime.
 */
const config: CodegenConfig = {
  overwrite: true,
  schema: process.env.GRAPHQL_SCHEMA_URL ?? "./schema.graphql",
  documents: ["src/**/*.{ts,vue}", "!src/**/__generated__/**"],
  ignoreNoDocuments: true,
  generates: {
    "src/services/graphql/__generated__/": {
      preset: "client",
      plugins: [],
      config: {
        useTypeImports: true,
      },
    },
  },
};

export default config;

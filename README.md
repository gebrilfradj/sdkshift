# SDKShift

[![CI](https://github.com/gebrilfradj/sdkshift/actions/workflows/ci.yml/badge.svg)](https://github.com/gebrilfradj/sdkshift/actions/workflows/ci.yml)

SDKShift turns documented SDK breaking changes into tested draft pull requests.

The current proof handles one real migration: OpenAI Node v4 resource
`.del()` methods renamed to `.delete()` in v5. It verifies the installed
package range, resolves the OpenAI import and client binding through the AST,
changes only method chains listed in OpenAI's
[official migration guide](https://github.com/openai/openai-node/blob/main/MIGRATION.md#http-method-naming),
updates the dependency, installs from the refreshed lockfile, and runs the
repository's own test command.

## Why the scope is narrow

An incorrect automated migration is worse than a notification. SDKShift
refuses a repository when it finds an OpenAI client use outside the rule's
verified coverage. It does not send unsupported code to a general model and
hope that tests catch the result.

## Try it

Requires Node.js 22 or newer.

```bash
npm install

node src/cli.js scan C:\path\to\repository
node src/cli.js migrate C:\path\to\repository
node src/cli.js validate C:\path\to\repository -- npm test
node src/cli.js migrate C:\path\to\repository --write
```

`migrate` is a dry run unless `--write` is supplied. `validate` copies the
repository, applies the migration there, refreshes the npm lockfile without
running lifecycle scripts, installs dependencies, and executes the supplied
command without changing the source checkout.

## Exact-base draft pull request

Publishing downloads the exact remote base SHA, migrates and tests that
archive, then creates a commit from only the validated files.

See the
[public draft migration PR](https://github.com/gebrilfradj/sdkshift-openai-v4-benchmark/pull/1),
including its exact base SHA and green CI checks.

```bash
$env:SDKSHIFT_GITHUB_TOKEN = gh auth token
node src/cli.js publish owner/repository `
  --base main `
  --branch sdkshift/openai-v5 `
  -- npm test
```

The token is read from the environment and is not written to reports.

## Reproducible benchmark

The owned
[OpenAI v4 benchmark](https://github.com/gebrilfradj/sdkshift-openai-v4-benchmark)
uses the real `openai@4.104.0` package and a local HTTP server:

| Scenario | Expected |
|---|---|
| Original v4 application | Tests pass |
| Dependency-only update to v5 | TypeScript build fails |
| SDKShift migration to v5 | Tests pass |

Run all three states:

```bash
npm run benchmark
```

The latest checked result is committed at
[`benchmark/results.json`](benchmark/results.json).

The benchmark is synthetic product evidence, not a customer, pilot, or user.
SDKShift currently has no external users and no revenue.

The concise recording plan is in [`docs/demo.md`](docs/demo.md).

## Current limitations

- Supports npm projects using an OpenAI v4 dependency range.
- Supports ESM imports and direct `const client = new OpenAI(...)` bindings.
- Refuses CommonJS, computed properties, and partially covered client usage.
- Handles only the documented v4-to-v5 delete-method migration.
- Uses a GitHub token for the CLI proof; a GitHub App is future work.

## Development

```bash
npm test
npm run benchmark
```

MIT licensed.

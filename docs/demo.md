# YC product demo

Target: 75 to 90 seconds. Record the terminal and the resulting GitHub draft
pull request. Use the public owned benchmark only.

## Before recording

```powershell
git clone https://github.com/gebrilfradj/sdkshift.git
git clone https://github.com/gebrilfradj/sdkshift-openai-v4-benchmark.git
Set-Location sdkshift
npm ci
```

Open these before recording:

1. `sdkshift-openai-v4-benchmark\src\delete-file.ts`
2. The benchmark repository's Actions page
3. The SDKShift-created draft pull request

Use a large terminal font. Do not show environment variables or the GitHub
token.

## Script

**0:00-0:12 - Show the break**

Show `client.files.del(fileId)` and `openai@4.104.0`.

Say:

> This application uses a real OpenAI v4 method that was removed in v5. A
> dependency-only upgrade fails TypeScript compilation.

**0:12-0:28 - Scan**

```powershell
node src\cli.js scan ..\sdkshift-openai-v4-benchmark
```

Say:

> SDKShift verifies the installed package range, resolves the imported OpenAI
> client through the AST, and matches the call to OpenAI's migration guide.

**0:28-0:55 - Exact isolated validation**

```powershell
node src\cli.js validate ..\sdkshift-openai-v4-benchmark -- npm test
```

Say:

> It applies the migration in an isolated copy, updates the lockfile, installs
> from that lockfile without lifecycle scripts, and runs the repository's real
> build and runtime test. The source checkout is unchanged.

**0:55-1:15 - Show the proof**

Show `benchmark\results.json`.

Say:

> The reproducible benchmark checks all three states: v4 passes, a version-only
> v5 upgrade fails, and the SDKShift migration passes.

**1:15-1:30 - Show the draft PR**

Show the PR's changed files, green CI check, exact base SHA, and link to the
official migration guide.

Say:

> The published result contains only the files tested from the exact remote
> base commit, and it remains a draft for human review.


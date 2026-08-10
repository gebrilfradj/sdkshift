#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crossSpawn = require("cross-spawn");
const {
  applyAndValidate,
  installDependencies,
  runCommand
} = require("../src");

const BENCHMARK_URL =
  "https://github.com/gebrilfradj/sdkshift-openai-v4-benchmark.git";

function run(root, command) {
  const result = crossSpawn.sync(command[0], command.slice(1), {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: false
  });
  return {
    exitCode: result.status,
    passed: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function clone(target) {
  const result = run(path.dirname(target), [
    "git",
    "clone",
    "--quiet",
    "--depth",
    "1",
    BENCHMARK_URL,
    path.basename(target)
  ]);
  if (!result.passed) throw new Error(`Benchmark clone failed: ${result.stderr}`);
}

function outputPath(args) {
  const index = args.indexOf("--output");
  return index === -1 ? null : args[index + 1];
}

function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdkshift-benchmark-"));
  try {
    const baselineRoot = path.join(temporaryRoot, "baseline");
    clone(baselineRoot);
    const baselineInstall = installDependencies(baselineRoot);
    const baseline =
      baselineInstall.status === "passed"
        ? runCommand(baselineRoot, ["npm", "test"])
        : baselineInstall;

    const naiveRoot = path.join(temporaryRoot, "naive");
    clone(naiveRoot);
    const naiveUpgrade = run(naiveRoot, [
      "npm",
      "install",
      "openai@5.0.0",
      "--save-exact",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund"
    ]);
    const naive = naiveUpgrade.passed
      ? runCommand(naiveRoot, ["npm", "test"])
      : { status: "failed", exitCode: naiveUpgrade.exitCode };

    const migratedRoot = path.join(temporaryRoot, "migrated");
    clone(migratedRoot);
    const migrated = applyAndValidate(migratedRoot, ["npm", "test"]);

    const results = {
      benchmark: "openai-v4-to-v5-delete-methods",
      repository: BENCHMARK_URL,
      sourceDependency: "openai@4.104.0",
      naiveTarget: "openai@5.0.0",
      sdkshiftTarget: "^5.0.0",
      baseline: {
        expected: "pass",
        outcome: baseline.status
      },
      naiveUpgrade: {
        expected: "fail",
        outcome: naive.status
      },
      sdkshiftMigration: {
        expected: "pass",
        outcome: migrated.validation?.status || migrated.status,
        findings: migrated.plan?.findings?.length || 0,
        changedPaths: migrated.changedPaths || []
      }
    };
    results.passed =
      results.baseline.outcome === "passed" &&
      results.naiveUpgrade.outcome === "failed" &&
      results.sdkshiftMigration.outcome === "passed";

    const json = `${JSON.stringify(results, null, 2)}\n`;
    const destination = outputPath(process.argv.slice(2));
    if (destination) {
      fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
      fs.writeFileSync(path.resolve(destination), json);
    }
    process.stdout.write(json);
    if (!results.passed) process.exitCode = 1;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();

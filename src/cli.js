#!/usr/bin/env node

const path = require("node:path");
const {
  migrateLocal,
  planMigration,
  publishRemote,
  validateLocal
} = require("./index");

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return args[index + 1];
}

function validationCommand(args) {
  const separator = args.indexOf("--");
  return separator === -1 ? [] : args.slice(separator + 1);
}

function setExitCode(report, command) {
  if (report.status === "blocked") process.exitCode = 2;
  if (command === "scan" && report.status === "migration-needed") {
    process.exitCode = 1;
  }
  if (report.status === "validation-failed") process.exitCode = 1;
}

function formatReport(report) {
  const plan = report.plan || report;
  const lines = [`Status: ${report.status}`];
  if (plan.migration?.id) lines.push(`Migration: ${plan.migration.id}`);
  for (const finding of plan.findings || []) {
    lines.push(
      `Finding: ${finding.file}:${finding.line || "?"} ${finding.before} -> ${
        finding.after
      }`
    );
  }
  for (const change of plan.changes || []) {
    lines.push(`Change: ${change.path}`);
  }
  for (const issue of plan.issues || []) {
    lines.push(
      `Blocked: ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`
    );
  }
  if (report.validation) {
    lines.push(
      `Validation: ${report.validation.status} (${report.validation.command.join(" ")})`
    );
  }
  if (report.pullRequest?.url) {
    lines.push(`Draft PR: ${report.pullRequest.url}`);
  }
  return lines.join("\n");
}

async function main() {
  const [command = "scan", target = ".", ...args] = process.argv.slice(2);
  if (!["scan", "migrate", "validate", "publish"].includes(command)) {
    throw new Error(
      "Usage: sdkshift <scan|migrate|validate|publish> <repository> [options]"
    );
  }

  let report;
  if (command === "publish") {
    const run = validationCommand(args);
    if (run.length === 0) {
      throw new Error("publish requires -- <validation command> [arguments].");
    }
    report = await publishRemote({
      repository: target,
      base: option(args, "--base", "main"),
      branch: option(args, "--branch"),
      title: option(args, "--title"),
      command: run
    });
  } else {
    const root = path.resolve(target);
    if (command === "scan") report = planMigration(root);
    if (command === "migrate") {
      report = migrateLocal(root, args.includes("--write"));
    }
    if (command === "validate") {
      const run = validationCommand(args);
      if (run.length === 0) {
        throw new Error("validate requires -- <command> [arguments].");
      }
      report = validateLocal(root, run);
    }
  }

  console.log(
    args.includes("--json")
      ? JSON.stringify(report, null, 2)
      : formatReport(report)
  );
  setExitCode(report, command);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}

module.exports = { formatReport, main };


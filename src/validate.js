const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crossSpawn = require("cross-spawn");
const { applyPlan, planMigration } = require("./migration");

const COPY_SKIPS = new Set([
  ".git",
  ".sdkshift",
  "coverage",
  "dist",
  "node_modules"
]);

function runCommand(root, command) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new TypeError("A validation command is required.");
  }
  const result = crossSpawn.sync(command[0], command.slice(1), {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: false
  });
  return {
    command,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function refreshPackageLock(root) {
  return runCommand(root, [
    "npm",
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund"
  ]);
}

function installDependencies(root) {
  return runCommand(root, [
    "npm",
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund"
  ]);
}

function applyAndValidate(root, command) {
  const plan = planMigration(root);
  if (plan.status !== "migration-needed") {
    return {
      status: plan.status,
      plan,
      validation: null,
      changedPaths: []
    };
  }

  const lockFile = path.join(root, "package-lock.json");
  const lockBefore = fs.existsSync(lockFile) ? fs.readFileSync(lockFile, "utf8") : null;
  applyPlan(root, plan);

  const lockRefresh = refreshPackageLock(root);
  if (lockRefresh.status !== "passed") {
    return {
      status: "validation-failed",
      stage: "lockfile",
      plan,
      validation: lockRefresh,
      changedPaths: plan.changes.map((change) => change.path)
    };
  }

  const install = installDependencies(root);
  if (install.status !== "passed") {
    return {
      status: "validation-failed",
      stage: "install",
      plan,
      validation: install,
      changedPaths: plan.changes.map((change) => change.path)
    };
  }

  const validation = runCommand(root, command);
  const changedPaths = plan.changes.map((change) => change.path);
  const lockAfter = fs.existsSync(lockFile) ? fs.readFileSync(lockFile, "utf8") : null;
  if (lockAfter !== lockBefore) changedPaths.push("package-lock.json");

  return {
    status: validation.status === "passed" ? "validated" : "validation-failed",
    stage: "tests",
    plan,
    install,
    validation,
    changedPaths: [...new Set(changedPaths)]
  };
}

function copyRepository(root, workspace) {
  fs.cpSync(root, workspace, {
    recursive: true,
    dereference: false,
    filter(source) {
      if (source === root) return true;
      const relative = path.relative(root, source);
      const topLevel = relative.split(path.sep)[0];
      if (COPY_SKIPS.has(topLevel)) return false;
      return !fs.lstatSync(source).isSymbolicLink();
    }
  });
}

function validateLocal(root, command) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdkshift-validate-"));
  const workspace = path.join(temporaryRoot, "repository");
  try {
    copyRepository(root, workspace);
    return applyAndValidate(workspace, command);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function migrateLocal(root, write) {
  const plan = planMigration(root);
  if (!write || plan.status !== "migration-needed") return plan;

  applyPlan(root, plan);
  const lockRefresh = refreshPackageLock(root);
  return {
    ...plan,
    applied: true,
    lockfile: lockRefresh
  };
}

module.exports = {
  applyAndValidate,
  installDependencies,
  migrateLocal,
  refreshPackageLock,
  runCommand,
  validateLocal
};

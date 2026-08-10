const fs = require("node:fs");
const path = require("node:path");
const babelParser = require("@babel/parser");
const traverseModule = require("@babel/traverse");
const t = require("@babel/types");
const recast = require("recast");
const semver = require("semver");
const { relativePath, sourceFiles } = require("./files");

const traverse = traverseModule.default || traverseModule;
const MIGRATION = {
  id: "openai-v4-to-v5-delete-methods",
  packageName: "openai",
  from: ">=4.0.0 <5.0.0",
  to: "^5.0.0",
  summary: "Rename documented OpenAI resource .del() methods to .delete().",
  source: "https://github.com/openai/openai-node/blob/main/MIGRATION.md#http-method-naming"
};

const SUPPORTED_CHAINS = new Set([
  "chat.completions.del",
  "files.del",
  "models.del",
  "fineTuning.checkpoints.permissions.del",
  "vectorStores.del",
  "vectorStores.files.del",
  "beta.assistants.del",
  "beta.threads.del",
  "beta.threads.messages.del",
  "responses.del",
  "evals.del",
  "evals.runs.del",
  "containers.del",
  "containers.files.del"
]);

const parser = {
  parse(source) {
    return babelParser.parse(source, {
      sourceType: "unambiguous",
      allowAwaitOutsideFunction: true,
      plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "classProperties",
        "importAttributes",
        "topLevelAwait"
      ],
      tokens: true
    });
  }
};

function issue(file, message, line) {
  return {
    file,
    line: line || null,
    message
  };
}

function importClassNames(programPath, file, issues) {
  const names = [];

  for (const statementPath of programPath.get("body")) {
    if (!statementPath.isImportDeclaration()) continue;
    if (statementPath.node.source.value !== "openai") continue;
    if (statementPath.node.importKind === "type") continue;

    for (const specifierPath of statementPath.get("specifiers")) {
      const specifier = specifierPath.node;
      const isOpenAIClass =
        t.isImportDefaultSpecifier(specifier) ||
        (t.isImportSpecifier(specifier) &&
          t.isIdentifier(specifier.imported, { name: "OpenAI" }));
      const isTypeOnly = specifier.importKind === "type";

      if (isOpenAIClass) {
        names.push(specifier.local.name);
      } else if (!isTypeOnly) {
        issues.push(
          issue(
            file,
            "Runtime imports from openai other than the OpenAI client are not supported.",
            specifier.loc?.start.line
          )
        );
      }
    }
  }

  if (names.length > 1) {
    issues.push(issue(file, "Multiple OpenAI client imports are not supported."));
  }
  return names;
}

function memberCallFromReference(referencePath) {
  const names = [];
  let currentPath = referencePath;

  while (
    currentPath.parentPath?.isMemberExpression() &&
    currentPath.parentPath.node.object === currentPath.node
  ) {
    const memberPath = currentPath.parentPath;
    if (memberPath.node.computed || !t.isIdentifier(memberPath.node.property)) {
      return null;
    }
    names.push(memberPath.node.property.name);
    currentPath = memberPath;
  }

  if (
    !currentPath.parentPath?.isCallExpression() ||
    currentPath.parentPath.node.callee !== currentPath.node
  ) {
    return null;
  }

  return {
    callPath: currentPath.parentPath,
    memberPath: currentPath,
    names
  };
}

function analyzeSource(file, source) {
  let ast;
  try {
    ast = recast.parse(source, { parser });
  } catch (error) {
    return {
      issues: [issue(file, `Could not parse source: ${error.message}`)],
      findings: []
    };
  }

  const issues = [];
  const findings = [];

  traverse(ast, {
    Program(programPath) {
      const classNames = importClassNames(programPath, file, issues);
      for (const className of classNames) {
        const classBinding = programPath.scope.getBinding(className);
        if (!classBinding) {
          issues.push(issue(file, `Could not resolve OpenAI import "${className}".`));
          continue;
        }

        const clientNames = [];
        for (const referencePath of classBinding.referencePaths) {
          const newPath = referencePath.parentPath;
          const declaratorPath = newPath?.parentPath;
          if (
            !newPath?.isNewExpression() ||
            newPath.node.callee !== referencePath.node ||
            !declaratorPath?.isVariableDeclarator() ||
            declaratorPath.node.init !== newPath.node ||
            !t.isIdentifier(declaratorPath.node.id)
          ) {
            issues.push(
              issue(
                file,
                `OpenAI import "${className}" has an unsupported use.`,
                referencePath.node.loc?.start.line
              )
            );
            continue;
          }
          clientNames.push(declaratorPath.node.id.name);
        }

        for (const clientName of clientNames) {
          const clientBinding = programPath.scope.getBinding(clientName);
          if (!clientBinding) {
            issues.push(issue(file, `Could not resolve OpenAI client "${clientName}".`));
            continue;
          }

          for (const referencePath of clientBinding.referencePaths) {
            const memberCall = memberCallFromReference(referencePath);
            const chain = memberCall?.names.join(".");
            if (!memberCall || !SUPPORTED_CHAINS.has(chain)) {
              issues.push(
                issue(
                  file,
                  `OpenAI client "${clientName}" has unsupported use${
                    chain ? ` "${chain}"` : ""
                  }. This migration only upgrades repositories whose client calls are fully covered.`,
                  referencePath.node.loc?.start.line
                )
              );
              continue;
            }

            memberCall.memberPath.node.property = t.identifier("delete");
            findings.push({
              migrationId: MIGRATION.id,
              file,
              line: referencePath.node.loc?.start.line || null,
              client: clientName,
              before: `${clientName}.${chain}()`,
              after: `${clientName}.${chain.replace(/\.del$/, ".delete")}()`,
              source: MIGRATION.source
            });
          }
        }
      }
      programPath.stop();
    }
  });

  if (issues.length > 0 || findings.length === 0) {
    return { issues, findings, output: source };
  }

  return {
    issues,
    findings,
    output: recast.print(ast).code
  };
}

function dependencyRecord(packageJson) {
  const locations = ["dependencies", "devDependencies"].filter(
    (field) => packageJson[field]?.openai
  );
  if (locations.length > 1) {
    return { error: "openai appears in both dependencies and devDependencies." };
  }
  if (locations.length === 0) return null;
  const field = locations[0];
  return { field, range: packageJson[field].openai };
}

function planMigration(root) {
  const packageFile = path.join(root, "package.json");
  if (!fs.existsSync(packageFile)) {
    return {
      status: "blocked",
      migration: MIGRATION,
      findings: [],
      changes: [],
      issues: [issue("package.json", "package.json was not found.")]
    };
  }

  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  } catch (error) {
    return {
      status: "blocked",
      migration: MIGRATION,
      findings: [],
      changes: [],
      issues: [issue("package.json", `Invalid JSON: ${error.message}`)]
    };
  }

  const dependency = dependencyRecord(packageJson);
  if (!dependency) {
    return {
      status: "compatible",
      migration: MIGRATION,
      findings: [],
      changes: [],
      issues: []
    };
  }
  if (dependency.error) {
    return {
      status: "blocked",
      migration: MIGRATION,
      findings: [],
      changes: [],
      issues: [issue("package.json", dependency.error)]
    };
  }

  const range = semver.validRange(dependency.range);
  if (!range) {
    return {
      status: "blocked",
      migration: MIGRATION,
      findings: [],
      changes: [],
      issues: [
        issue(
          "package.json",
          `Unsupported openai dependency range "${dependency.range}".`
        )
      ]
    };
  }

  if (!semver.subset(range, MIGRATION.from)) {
    const minimum = semver.minVersion(range);
    if (minimum && minimum.major >= 5) {
      return {
        status: "compatible",
        migration: MIGRATION,
        findings: [],
        changes: [],
        issues: []
      };
    }
    return {
      status: "blocked",
      migration: MIGRATION,
      findings: [],
      changes: [],
      issues: [
        issue(
          "package.json",
          `The openai range "${dependency.range}" is not confined to v4.`
        )
      ]
    };
  }

  const issues = [];
  const findings = [];
  const changes = [];
  for (const sourceFile of sourceFiles(root)) {
    const before = fs.readFileSync(sourceFile, "utf8");
    if (!/(?:from\s*["']openai["']|require\(\s*["']openai["']\s*\))/.test(before)) {
      continue;
    }
    const file = relativePath(root, sourceFile);
    if (/require\(\s*["']openai["']\s*\)/.test(before)) {
      issues.push(
        issue(file, "CommonJS OpenAI imports are not supported by this migration.")
      );
      continue;
    }

    const result = analyzeSource(file, before);
    issues.push(...result.issues);
    findings.push(...result.findings);
    if (result.output !== before) {
      changes.push({ path: file, before, after: result.output });
    }
  }

  if (issues.length > 0) {
    return {
      status: "blocked",
      migration: MIGRATION,
      findings,
      changes: [],
      issues
    };
  }
  if (findings.length === 0) {
    return {
      status: "compatible",
      migration: MIGRATION,
      findings: [],
      changes: [],
      issues: []
    };
  }

  const packageBefore = fs.readFileSync(packageFile, "utf8");
  packageJson[dependency.field].openai = MIGRATION.to;
  const packageAfter = `${JSON.stringify(packageJson, null, 2)}\n`;
  changes.unshift({
    path: "package.json",
    before: packageBefore,
    after: packageAfter
  });

  return {
    status: "migration-needed",
    migration: MIGRATION,
    findings,
    changes,
    issues: []
  };
}

function applyPlan(root, plan) {
  if (plan.status !== "migration-needed") {
    throw new Error(`Cannot apply a plan with status "${plan.status}".`);
  }
  for (const change of plan.changes) {
    const file = path.join(root, ...change.path.split("/"));
    fs.writeFileSync(file, change.after);
  }
}

module.exports = {
  MIGRATION,
  SUPPORTED_CHAINS,
  analyzeSource,
  applyPlan,
  planMigration
};


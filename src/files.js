const fs = require("node:fs");
const path = require("node:path");

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".sdkshift",
  "coverage",
  "dist",
  "node_modules"
]);

function sourceFiles(root) {
  const files = [];

  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) visit(target);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(target);
      }
    }
  }

  visit(root);
  return files.sort();
}

function relativePath(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside repository: ${file}`);
  }
  return relative.split(path.sep).join("/");
}

function repositoryPath(value) {
  const parts = String(value || "").split("/");
  if (
    parts.length !== 2 ||
    parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..")
  ) {
    throw new Error("Invalid GitHub repository. Expected owner/name.");
  }
  return parts.map(encodeURIComponent).join("/");
}

function gitFilePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Invalid repository file path: ${value}`);
  }
  return normalized;
}

module.exports = {
  gitFilePath,
  relativePath,
  repositoryPath,
  sourceFiles
};


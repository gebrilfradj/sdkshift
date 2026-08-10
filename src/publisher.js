const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tar = require("tar");
const { gitFilePath } = require("./files");
const { checkBranch, GitHubClient } = require("./github");
const { applyAndValidate } = require("./validate");

async function prepareRemoteWorkspace(options) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdkshift-publish-"));
  const workspace = path.join(temporaryRoot, "repository");
  const archiveFile = path.join(temporaryRoot, "repository.tgz");
  fs.mkdirSync(workspace);

  try {
    const archive = await options.client.archive(options.repository, options.sha);
    fs.writeFileSync(archiveFile, archive);
    await tar.x({
      cwd: workspace,
      file: archiveFile,
      strip: 1,
      preservePaths: false
    });

    const result = applyAndValidate(workspace, options.command);
    if (result.status !== "validated") return result;

    const files = result.changedPaths.map((relative) => {
      const safePath = gitFilePath(relative);
      const file = path.join(workspace, ...safePath.split("/"));
      return {
        path: safePath,
        mode: fs.statSync(file).mode & 0o111 ? "100755" : "100644",
        content: fs.readFileSync(file, "utf8")
      };
    });
    return { ...result, files };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function pullRequestBody(prepared, baseSha) {
  const files = prepared.files.map((file) => `- \`${file.path}\``).join("\n");
  const command = prepared.validation.command.map(JSON.stringify).join(" ");
  return [
    "SDKShift applied a documented OpenAI SDK migration and validated the exact remote base commit.",
    "",
    `- Base commit: \`${baseSha}\``,
    `- Migration: [${prepared.plan.migration.id}](${prepared.plan.migration.source})`,
    `- Validation: \`${command}\``,
    "",
    "Changed files:",
    files,
    "",
    "This is a draft pull request and requires human review before merge."
  ].join("\n");
}

async function publishRemote(options) {
  const client =
    options.client ||
    new GitHubClient({
      token: options.token || process.env.SDKSHIFT_GITHUB_TOKEN
    });
  const base = checkBranch(options.base || "main");
  const reference = await client.getReference(options.repository, base);
  const parent = reference?.object?.sha;
  const commit = await client.getCommit(options.repository, parent);
  const shortSha = parent.slice(0, 8);
  const branch = checkBranch(
    options.branch || `sdkshift/openai-v5-${shortSha}`
  );
  const prepare = options.prepare || prepareRemoteWorkspace;
  const prepared = await prepare({
    client,
    repository: options.repository,
    sha: parent,
    command: options.command
  });

  if (prepared.status !== "validated") {
    return {
      status: prepared.status,
      repository: options.repository,
      base,
      baseSha: parent,
      ...prepared
    };
  }

  const tree = await client.createTree(
    options.repository,
    commit.tree.sha,
    prepared.files
  );
  const title = options.title || "Migrate OpenAI SDK v4 delete methods to v5";
  const migrationCommit = await client.createCommit(
    options.repository,
    title,
    tree.sha,
    parent
  );
  await client.createReference(options.repository, branch, migrationCommit.sha);
  const pullRequest = await client.createPullRequest(options.repository, {
    title,
    head: branch,
    base,
    body: pullRequestBody(prepared, parent)
  });

  return {
    status: "draft-pr-created",
    repository: options.repository,
    base,
    baseSha: parent,
    branch,
    commit: migrationCommit.sha,
    plan: prepared.plan,
    validation: prepared.validation,
    files: prepared.files.map((file) => file.path),
    pullRequest: {
      number: pullRequest.number,
      url: pullRequest.html_url,
      draft: pullRequest.draft
    }
  };
}

module.exports = {
  prepareRemoteWorkspace,
  publishRemote,
  pullRequestBody
};


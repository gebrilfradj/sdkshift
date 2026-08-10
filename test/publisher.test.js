const assert = require("node:assert/strict");
const test = require("node:test");
const { publishRemote } = require("../src");

const parent = "a".repeat(40);
const baseTree = "b".repeat(40);
const newTree = "c".repeat(40);
const newCommit = "d".repeat(40);

test("publishes exactly the validated remote base commit", async () => {
  const calls = [];
  const client = {
    async getReference(repository, branch) {
      calls.push(["reference", repository, branch]);
      return { object: { sha: parent } };
    },
    async getCommit(repository, sha) {
      calls.push(["commit", repository, sha]);
      return { tree: { sha: baseTree } };
    },
    async createTree(repository, tree, files) {
      calls.push(["tree", repository, tree, files]);
      return { sha: newTree };
    },
    async createCommit(repository, message, tree, sha) {
      calls.push(["create-commit", repository, message, tree, sha]);
      return { sha: newCommit };
    },
    async createReference(repository, branch, sha) {
      calls.push(["create-reference", repository, branch, sha]);
    },
    async createPullRequest(repository, options) {
      calls.push(["pull", repository, options]);
      return { number: 12, html_url: "https://github.test/pr/12", draft: true };
    }
  };
  const prepare = async (options) => {
    assert.equal(options.sha, parent);
    return {
      status: "validated",
      plan: {
        migration: {
          id: "openai-v4-to-v5-delete-methods",
          source: "https://example.test/migration"
        }
      },
      validation: { command: ["npm", "test"], status: "passed" },
      files: [{ path: "src/file.ts", content: "client.files.delete('id');\n" }]
    };
  };

  const report = await publishRemote({
    client,
    prepare,
    repository: "owner/repository",
    base: "main",
    branch: "sdkshift/test",
    command: ["npm", "test"]
  });

  assert.equal(report.status, "draft-pr-created");
  assert.equal(report.baseSha, parent);
  assert.deepEqual(calls[1], ["commit", "owner/repository", parent]);
  assert.equal(calls.find(([name]) => name === "create-commit")[4], parent);
  assert.equal(report.pullRequest.draft, true);
});

test("does not publish when exact-base validation fails", async () => {
  const client = {
    async getReference() {
      return { object: { sha: parent } };
    },
    async getCommit() {
      return { tree: { sha: baseTree } };
    },
    async createTree() {
      assert.fail("createTree must not run");
    }
  };

  const report = await publishRemote({
    client,
    prepare: async () => ({
      status: "validation-failed",
      validation: { status: "failed" },
      plan: { status: "migration-needed" }
    }),
    repository: "owner/repository",
    command: ["npm", "test"]
  });

  assert.equal(report.status, "validation-failed");
});


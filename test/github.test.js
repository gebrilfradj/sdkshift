const assert = require("node:assert/strict");
const test = require("node:test");
const { checkBranch, GitHubClient, objectId } = require("../src/github");

test("validates repository publishing inputs", () => {
  assert.equal(checkBranch("sdkshift/openai-v5"), "sdkshift/openai-v5");
  assert.throws(() => checkBranch("../main"), /Invalid Git branch/);
  assert.throws(() => objectId("../commit"), /Invalid Git object ID/);
});

test("creates draft pull requests with bearer authentication", async () => {
  const requests = [];
  const client = new GitHubClient({
    token: "test-token",
    apiUrl: "https://github.test",
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify({ number: 7, html_url: "https://github.test/pr/7", draft: true }),
        { status: 201 }
      );
    }
  });

  await client.createPullRequest("owner/repository", {
    title: "Migration",
    head: "sdkshift/openai-v5",
    base: "main",
    body: "Validated"
  });

  assert.equal(requests[0].url, "https://github.test/repos/owner/repository/pulls");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(JSON.parse(requests[0].options.body).draft, true);
});


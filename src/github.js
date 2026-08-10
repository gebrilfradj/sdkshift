const { gitFilePath, repositoryPath } = require("./files");

function objectId(value) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(String(value || ""))) {
    throw new Error("Invalid Git object ID.");
  }
  return value;
}

function checkBranch(branch) {
  const value = String(branch || "");
  const invalidComponent = value
    .split("/")
    .some((part) => !part || part.startsWith(".") || part.endsWith(".lock"));
  if (
    value === "@" ||
    value.endsWith(".") ||
    value.includes("..") ||
    value.includes("@{") ||
    /[\x00-\x20\x7f~^:?*[\\]/.test(value) ||
    invalidComponent
  ) {
    throw new Error(`Invalid Git branch "${value}".`);
  }
  return value;
}

class GitHubClient {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || "https://api.github.com";
    this.fetch = options.fetch || globalThis.fetch;
    this.token = options.token;
    if (!this.token) throw new Error("A GitHub token is required.");
  }

  async request(method, endpoint, body) {
    const response = await this.fetch(`${this.apiUrl}${endpoint}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!response.ok) {
      const detail = data?.message ? `: ${data.message}` : "";
      throw new Error(
        `GitHub ${method} ${endpoint} failed (${response.status})${detail}`
      );
    }
    return data;
  }

  async archive(repository, sha) {
    const response = await this.fetch(
      `${this.apiUrl}/repos/${repositoryPath(repository)}/tarball/${objectId(sha)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );
    if (!response.ok) {
      throw new Error(`GitHub archive download failed (${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  getReference(repository, branch) {
    return this.request(
      "GET",
      `/repos/${repositoryPath(repository)}/git/ref/heads/${encodeURIComponent(
        checkBranch(branch)
      )}`
    );
  }

  getCommit(repository, sha) {
    return this.request(
      "GET",
      `/repos/${repositoryPath(repository)}/git/commits/${objectId(sha)}`
    );
  }

  createTree(repository, baseTree, files) {
    return this.request("POST", `/repos/${repositoryPath(repository)}/git/trees`, {
      base_tree: objectId(baseTree),
      tree: files.map((file) => ({
        path: gitFilePath(file.path),
        mode: file.mode || "100644",
        type: "blob",
        content: file.content
      }))
    });
  }

  createCommit(repository, message, tree, parent) {
    return this.request("POST", `/repos/${repositoryPath(repository)}/git/commits`, {
      message,
      tree: objectId(tree),
      parents: [objectId(parent)]
    });
  }

  createReference(repository, branch, sha) {
    return this.request("POST", `/repos/${repositoryPath(repository)}/git/refs`, {
      ref: `refs/heads/${checkBranch(branch)}`,
      sha: objectId(sha)
    });
  }

  createPullRequest(repository, options) {
    return this.request("POST", `/repos/${repositoryPath(repository)}/pulls`, {
      title: options.title,
      head: checkBranch(options.head),
      base: checkBranch(options.base),
      body: options.body,
      draft: true
    });
  }
}

module.exports = {
  checkBranch,
  GitHubClient,
  objectId
};


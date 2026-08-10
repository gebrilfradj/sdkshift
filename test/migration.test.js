const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { applyPlan, planMigration } = require("../src");

function fixture(source, version = "4.104.0") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdkshift-test-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        type: "module",
        dependencies: { openai: version }
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(path.join(root, "src", "delete-file.ts"), source);
  return root;
}

const supportedSource = [
  'import OpenAI from "openai";',
  "const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });",
  "export async function remove(id: string) {",
  "  return client.files.del(id);",
  "}",
  ""
].join("\n");

test("plans a package-aware OpenAI delete migration", (t) => {
  const root = fixture(supportedSource);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const plan = planMigration(root);

  assert.equal(plan.status, "migration-needed");
  assert.equal(plan.findings.length, 1);
  assert.equal(plan.findings[0].before, "client.files.del()");
  assert.match(
    plan.changes.find((change) => change.path === "src/delete-file.ts").after,
    /client\.files\.delete\(id\)/
  );
  assert.equal(
    JSON.parse(plan.changes.find((change) => change.path === "package.json").after)
      .dependencies.openai,
    "^5.0.0"
  );
  assert.equal(fs.readFileSync(path.join(root, "src", "delete-file.ts"), "utf8"), supportedSource);
});

test("applies only planned files", (t) => {
  const root = fixture(supportedSource);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const plan = planMigration(root);
  applyPlan(root, plan);

  assert.match(
    fs.readFileSync(path.join(root, "src", "delete-file.ts"), "utf8"),
    /client\.files\.delete\(id\)/
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).dependencies.openai,
    "^5.0.0"
  );
});

test("does not rename unrelated del methods", (t) => {
  const source = [
    'import OpenAI from "openai";',
    "const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });",
    "const router = { del() {} };",
    "router.del();",
    "export const remove = (id: string) => client.files.del(id);",
    ""
  ].join("\n");
  const root = fixture(source);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const plan = planMigration(root);
  const output = plan.changes.find((change) => change.path.endsWith(".ts")).after;

  assert.match(output, /router\.del\(\)/);
  assert.match(output, /client\.files\.delete\(id\)/);
});

test("supports aliased OpenAI imports and client names", (t) => {
  const source = [
    'import { OpenAI as SDK } from "openai";',
    'const api = new SDK({ apiKey: "test" });',
    "export const remove = (id: string) => api.models.del(id);",
    ""
  ].join("\n");
  const root = fixture(source);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const plan = planMigration(root);

  assert.equal(plan.status, "migration-needed");
  assert.match(
    plan.changes.find((change) => change.path.endsWith(".ts")).after,
    /api\.models\.delete\(id\)/
  );
});

test("refuses partially covered OpenAI clients", (t) => {
  const source = [
    'import OpenAI from "openai";',
    'const client = new OpenAI({ apiKey: "test" });',
    "client.files.del('file-1');",
    "client.files.list();",
    ""
  ].join("\n");
  const root = fixture(source);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const plan = planMigration(root);

  assert.equal(plan.status, "blocked");
  assert.match(plan.issues[0].message, /unsupported use "files\.list"/);
  assert.equal(plan.changes.length, 0);
});

test("refuses dependency ranges not confined to v4", (t) => {
  const root = fixture(supportedSource, ">=4");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const plan = planMigration(root);

  assert.equal(plan.status, "blocked");
  assert.match(plan.issues[0].message, /not confined to v4/);
});

test("reports v5 repositories as compatible", (t) => {
  const root = fixture(supportedSource.replace(".del(", ".delete("), "^5.0.0");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const plan = planMigration(root);

  assert.equal(plan.status, "compatible");
  assert.equal(plan.changes.length, 0);
});

test("refuses CommonJS imports rather than guessing bindings", (t) => {
  const root = fixture(
    [
      'const OpenAI = require("openai");',
      'const client = new OpenAI({ apiKey: "test" });',
      "client.files.del('file-1');",
      ""
    ].join("\n")
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const plan = planMigration(root);

  assert.equal(plan.status, "blocked");
  assert.match(plan.issues[0].message, /CommonJS/);
});


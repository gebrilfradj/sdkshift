const assert = require("node:assert/strict");
const test = require("node:test");
const { formatReport } = require("../src/cli");

test("formats migration evidence for a terminal demo", () => {
  const output = formatReport({
    status: "validated",
    plan: {
      migration: { id: "openai-v4-to-v5-delete-methods" },
      findings: [
        {
          file: "src/delete-file.ts",
          line: 9,
          before: "client.files.del()",
          after: "client.files.delete()"
        }
      ],
      changes: [{ path: "package.json" }, { path: "src/delete-file.ts" }]
    },
    validation: { status: "passed", command: ["npm", "test"] }
  });

  assert.match(output, /Status: validated/);
  assert.match(output, /src\/delete-file\.ts:9/);
  assert.match(output, /Validation: passed \(npm test\)/);
});


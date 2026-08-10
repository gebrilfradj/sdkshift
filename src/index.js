const { MIGRATION, applyPlan, planMigration } = require("./migration");
const { publishRemote } = require("./publisher");
const {
  applyAndValidate,
  installDependencies,
  migrateLocal,
  runCommand,
  validateLocal
} = require("./validate");

module.exports = {
  MIGRATION,
  applyAndValidate,
  applyPlan,
  installDependencies,
  migrateLocal,
  planMigration,
  publishRemote,
  runCommand,
  validateLocal
};

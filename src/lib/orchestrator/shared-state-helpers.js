const store = require("../../server/store");
const { nowIso } = require("../utils/id");

function updateJob(jobId, updater) {
  const job = store.getJob(jobId);
  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const updated = {
    ...job,
    ...updater(job),
    updatedAt: nowIso()
  };

  store.saveJob(updated);
  return updated;
}

module.exports = { updateJob };

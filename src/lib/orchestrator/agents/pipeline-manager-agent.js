const { createId, nowIso } = require("../../utils/id");

function runPipelineManagerAgent({ job, nextStatus, strategyDecision, fitAssessment, globalPolicy }) {
  if (strategyDecision === "deprioritize" || globalPolicy?.focusMode === "focused" && job.priority === "low") {
    return null;
  }

  const dueSoon = globalPolicy?.focusMode === "focused";
  const cautiousNote =
    strategyDecision === "cautious_proceed"
      ? `Proceed carefully. Focus first on these risks: ${(fitAssessment?.riskFlags || []).slice(0, 2).join(" / ") || "review role-specific risks."}`
      : null;

  const mapping = {
    to_prepare: {
      title:
        strategyDecision === "cautious_proceed"
          ? `Prep cautiously for ${job.company}`
          : `Start prep for ${job.company}`,
      type: "review_fit_assessment",
      note: cautiousNote || "High-priority role. Move into prep while momentum is fresh."
    },
    ready_to_apply: {
      title: `Confirm final materials for ${job.company}`,
      type: "submit_application",
      note:
        strategyDecision === "cautious_proceed"
          ? "Final user confirmation required. Recheck strategic risks before submission."
          : "Final user confirmation required before marking as applied."
    },
    applied: {
      title: `Track follow-up timing for ${job.company}`,
      type: "send_follow_up",
      note: "Check response channel in 5-7 business days."
    },
    follow_up: {
      title: `Review response and prepare interview stories for ${job.company}`,
      type: "log_interview",
      note: "Use follow-up period to tighten interview narrative."
    }
  };

  const taskConfig = mapping[nextStatus];
  if (!taskConfig) {
    return null;
  }

  return {
    id: createId("task"),
    jobId: job.id,
    type: taskConfig.type,
    title: taskConfig.title,
    status: "todo",
    dueAt: dueSoon ? nowIso() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    note: taskConfig.note,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

module.exports = { runPipelineManagerAgent };

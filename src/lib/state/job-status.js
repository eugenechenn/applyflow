const JOB_STATUSES = [
  "inbox",
  "evaluating",
  "to_prepare",
  "ready_to_apply",
  "applied",
  "follow_up",
  "interviewing",
  "rejected",
  "offer",
  "archived"
];

const ALLOWED_JOB_TRANSITIONS = {
  inbox: ["evaluating", "archived"],
  evaluating: ["to_prepare", "archived"],
  to_prepare: ["ready_to_apply", "archived"],
  ready_to_apply: ["applied", "archived"],
  applied: ["follow_up", "interviewing", "rejected", "archived"],
  follow_up: ["interviewing", "rejected", "archived"],
  interviewing: ["offer", "rejected", "archived"],
  rejected: ["archived"],
  offer: ["archived"],
  archived: []
};

function canTransitionJobStatus(currentStatus, nextStatus) {
  return Boolean(
    ALLOWED_JOB_TRANSITIONS[currentStatus] &&
      ALLOWED_JOB_TRANSITIONS[currentStatus].includes(nextStatus)
  );
}

function getAllowedNextStatuses(currentStatus) {
  return ALLOWED_JOB_TRANSITIONS[currentStatus] || [];
}

function getRecommendedNextStatuses(currentStatus) {
  const recommendedMap = {
    inbox: ["evaluating"],
    evaluating: ["to_prepare"],
    to_prepare: ["ready_to_apply"],
    ready_to_apply: ["applied"],
    applied: ["follow_up", "interviewing"],
    follow_up: ["interviewing", "rejected"],
    interviewing: ["offer", "rejected"],
    rejected: ["archived"],
    offer: ["archived"],
    archived: []
  };

  return recommendedMap[currentStatus] || [];
}

function assertJobStatusTransition(currentStatus, nextStatus) {
  if (!canTransitionJobStatus(currentStatus, nextStatus)) {
    const error = new Error(
      `Cannot move job from ${currentStatus} to ${nextStatus}.`
    );
    error.code = "INVALID_STATUS_TRANSITION";
    error.details = { currentStatus, nextStatus };
    throw error;
  }
}

module.exports = {
  JOB_STATUSES,
  ALLOWED_JOB_TRANSITIONS,
  canTransitionJobStatus,
  getAllowedNextStatuses,
  getRecommendedNextStatuses,
  assertJobStatusTransition
};

import type { JobStatus } from "../../types/applyflow";

export const JOB_STATUSES: JobStatus[] = [
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

export const ALLOWED_JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
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

export function canTransitionJobStatus(
  currentStatus: JobStatus,
  nextStatus: JobStatus
): boolean {
  return ALLOWED_JOB_TRANSITIONS[currentStatus].includes(nextStatus);
}

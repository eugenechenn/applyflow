export type ISODateString = string;

export type JobStatus =
  | "inbox"
  | "evaluating"
  | "to_prepare"
  | "ready_to_apply"
  | "applied"
  | "follow_up"
  | "interviewing"
  | "rejected"
  | "offer"
  | "archived";

export type Recommendation = "apply" | "cautious" | "skip";
export type StrategyDecision = "proceed" | "cautious_proceed" | "deprioritize" | "avoid";
export type TaskStatus = "todo" | "in_progress" | "done" | "skipped";
export type TaskType =
  | "complete_profile"
  | "review_fit_assessment"
  | "tailor_resume"
  | "prepare_intro"
  | "prepare_qa"
  | "submit_application"
  | "send_follow_up"
  | "log_interview"
  | "complete_reflection";

export interface UserProfile {
  id: string;
  fullName: string;
  headline: string;
  yearsOfExperience: number;
  education: string;
  location: string;
  targetRoles: string[];
  targetIndustries: string[];
  preferredLocations: string[];
  workModes: Array<"onsite" | "hybrid" | "remote">;
  salaryExpectation?: string;
  summary: string;
  strengths: string[];
  coreSkills: string[];
  keyProjects: Array<{
    id: string;
    name: string;
    role: string;
    bullets: string[];
    metrics?: string[];
  }>;
  constraints: string[];
  baseResume: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Job {
  id: string;
  source: "manual" | "url" | "import";
  sourceLabel: string;
  url?: string;
  company: string;
  title: string;
  location: string;
  department?: string;
  employmentType?: string;
  salaryRange?: string;
  jdRaw: string;
  jdStructured: {
    summary: string;
    responsibilities: string[];
    requirements: string[];
    preferredQualifications: string[];
    keywords: string[];
    riskFlags: string[];
  };
  status: JobStatus;
  priority: "high" | "medium" | "low";
  strategyDecision?: StrategyDecision;
  strategyReasoning?: string;
  policyOverride?: {
    action: "force_proceed" | "ignore_policy" | "force_archive";
    active: boolean;
    reason?: string;
    appliedAt: ISODateString;
  };
  fitAssessmentId?: string;
  applicationPrepId?: string;
  latestInterviewReflectionId?: string;
  notes?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface FitAssessment {
  id: string;
  jobId: string;
  profileId: string;
  fitScore: number;
  recommendation: Recommendation;
  strategyDecision: StrategyDecision;
  strategyReasoning: string;
  historyInfluenceSummary?: string;
  policyInfluenceSummary?: string;
  decisionBreakdown?: {
    baseScore: number;
    historyAdjustment: number;
    policyAdjustment: number;
    finalScore: number;
    finalDecision: StrategyDecision;
  };
  activePolicyVersion?: string;
  policyProposalId?: string | null;
  overrideApplied?: boolean;
  overrideSummary?: string | null;
  confidence: number;
  decisionSummary: string;
  whyApply: string[];
  keyGaps: string[];
  riskFlags: string[];
  suggestedAction: string;
  editable: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ApplicationPrep {
  id: string;
  jobId: string;
  profileId: string;
  version: number;
  resumeTailoring: {
    targetKeywords: string[];
    rewriteBullets: Array<{
      source: string;
      rewritten: string;
    }>;
  };
  selfIntro: {
    short: string;
    medium: string;
  };
  tailoredSummary?: string;
  whyMe?: string;
  qaDraft: Array<{
    question: string;
    draftAnswer: string;
  }>;
  talkingPoints?: string[];
  coverNote: string;
  outreachNote?: string;
  checklist: Array<{
    key: string;
    label: string;
    completed: boolean;
  }>;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ApplicationTask {
  id: string;
  jobId: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  dueAt?: ISODateString;
  note?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface InterviewReflection {
  id: string;
  jobId: string;
  profileId: string;
  roundName: string;
  interviewerType: string;
  interviewDate: ISODateString;
  questionsAsked: string[];
  answerHighlights: string[];
  failureReasons: string[];
  successSignals: string[];
  skillGaps: string[];
  weakSpots: string[];
  strengthsObserved: string[];
  improvementActions: string[];
  strategyFeedback: string[];
  summary: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ActivityLog {
  id: string;
  entityType:
    | "profile"
    | "job"
    | "fit_assessment"
    | "application_prep"
    | "task"
    | "interview_reflection";
  entityId: string;
  action:
    | "profile_saved"
    | "job_created"
    | "fit_generated"
    | "prep_saved"
    | "job_status_changed"
    | "interview_reflected"
    | "bad_case_marked"
    | "bad_case_cleared"
    | "job_override_applied";
  actor: "user" | "system";
  summary: string;
  agentName?: string | null;
  inputSummary?: string | null;
  outputSummary?: string | null;
  decisionReason?: string | null;
  policyInfluenceSummary?: string | null;
  decisionBreakdown?: {
    baseScore: number;
    historyAdjustment: number;
    policyAdjustment: number;
    finalScore: number;
    finalDecision: string;
  } | null;
  activePolicyVersion?: string | null;
  policyProposalId?: string | null;
  overrideApplied?: boolean | null;
  overrideSummary?: string | null;
  jobId?: string;
  timestamp?: ISODateString;
  metadata?: Record<string, unknown>;
  createdAt: ISODateString;
}

export interface BadCase {
  id: string;
  jobId: string;
  company: string;
  title: string;
  rawJd: string;
  fitAssessment: FitAssessment | null;
  finalStatus: JobStatus;
  issueDescription?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface StrategyProfile {
  id: string;
  preferredRoles?: string[];
  riskyRoles?: string[];
  successPatterns?: string[];
  failurePatterns?: string[];
  scoreBias: {
    roleBiases: Record<string, number>;
    industryBiases: Record<string, number>;
  };
  positiveSignals: string[];
  cautionSignals: string[];
  learnedFromInterviews: string[];
  updatedAt: ISODateString;
}

export interface GlobalStrategyPolicy {
  id: string;
  version?: number;
  appliedProposalId?: string | null;
  preferredRoles: string[];
  riskyRoles: string[];
  preferredIndustries: string[];
  riskyIndustries: string[];
  preferredLocations: string[];
  riskyLocations: string[];
  successPatterns: string[];
  failurePatterns: string[];
  targetRolesPriority: string[];
  avoidPatterns: string[];
  riskTolerance: "low" | "medium" | "high";
  focusMode: "focused" | "balanced" | "exploratory";
  policySummary: string;
  lastUpdatedAt: ISODateString;
  updatedAt: ISODateString;
}

export interface PolicyChangeProposal {
  id: string;
  createdAt: ISODateString;
  triggerType: "interview_reflection" | "bad_case" | "metrics_shift" | "manual_review" | "profile_update" | "system_refresh";
  triggerSourceId?: string | null;
  oldPolicySnapshot: GlobalStrategyPolicy | null;
  proposedPolicySnapshot: GlobalStrategyPolicy;
  diffSummary: string[];
  reasonSummary: string;
  status: "pending" | "approved" | "rejected" | "applied" | "reverted";
  reviewerNote?: string | null;
  appliedAt?: ISODateString | null;
  revertedAt?: ISODateString | null;
}

export interface PolicyAuditLog {
  id: string;
  timestamp: ISODateString;
  eventType:
    | "proposal_created"
    | "proposal_approved"
    | "proposal_rejected"
    | "policy_applied"
    | "policy_reverted"
    | "user_override_applied";
  actor: "system" | "user";
  relatedProposalId?: string | null;
  summary: string;
}

import type {
  ActivityLog,
  ApplicationPrep,
  ApplicationTask,
  FitAssessment,
  InterviewReflection,
  Job,
  UserProfile
} from "../types/applyflow";

export interface ApplyFlowDemoData {
  profile: UserProfile;
  jobs: Job[];
  fitAssessments: FitAssessment[];
  applicationPreps: ApplicationPrep[];
  applicationTasks: ApplicationTask[];
  interviewReflections: InterviewReflection[];
  activityLogs: ActivityLog[];
}

// Runtime source of truth lives in `applyflow-demo-data.js` so the zero-dependency
// local server can load it directly without a TypeScript build step.
export { demoData } from "./applyflow-demo-data.js";

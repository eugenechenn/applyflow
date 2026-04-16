const { runUrlImportAgent } = require("./agents/url-import-agent");
const { runJobIngestionAgent } = require("./agents/job-ingestion-agent");
const { runFitEvaluationAgent } = require("./agents/fit-evaluation-agent");
const { runApplicationPrepAgent } = require("./agents/application-prep-agent");
const { runPipelineManagerAgent } = require("./agents/pipeline-manager-agent");
const { runInterviewReflectionAgent } = require("./agents/interview-reflection-agent");

const agentRegistry = {
  urlImport: runUrlImportAgent,
  jobIngestion: runJobIngestionAgent,
  fitEvaluation: runFitEvaluationAgent,
  applicationPrep: runApplicationPrepAgent,
  pipelineManager: runPipelineManagerAgent,
  interviewReflection: runInterviewReflectionAgent
};

module.exports = { agentRegistry };

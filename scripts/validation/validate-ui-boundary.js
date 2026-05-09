"use strict";

const fs = require("fs");
const path = require("path");

const appJsPath = path.resolve(process.cwd(), "public/app.js");
const appJsSource = fs.readFileSync(appJsPath, "utf8");
const workflowControllerPath = path.resolve(process.cwd(), "src/lib/orchestrator/workflow-controller.js");
const workflowControllerSource = fs.readFileSync(workflowControllerPath, "utf8");
const apiRoutesPath = path.resolve(process.cwd(), "src/server/routes/api.js");
const apiRoutesSource = fs.readFileSync(apiRoutesPath, "utf8");

const forbiddenUiPatterns = [
  { label: "legacy_resume_structuredProfile", pattern: /structuredProfile\b/ },
  { label: "legacy_resume_cleanedText", pattern: /cleanedText\b/ },
  { label: "legacy_fitAssessments_list", pattern: /fitAssessments\b/ },
  { label: "legacy_fitAssessment_payload", pattern: /data\.fitAssessment\b/ },
  { label: "legacy_decision_breakdown", pattern: /decisionBreakdown\b/ },
  { label: "legacy_activity_logs_payload", pattern: /data\.activityLogs\b/ },
  { label: "legacy_tailoring_execution_actions", pattern: /data\.executionActions\b/ },
  { label: "legacy_discovery_raw_lead_processing", pattern: /data\.leadProcessingResult\b/ },
  { label: "legacy_profile_master_resume_textarea", pattern: /name="masterResume"/ },
  { label: "legacy_export_via_api_post_docx", pattern: /api\(\s*`\/api\/jobs\/\$\{job\.id\}\/export-docx`/ },
  { label: "legacy_export_via_api_post_pdf", pattern: /api\(\s*`\/api\/jobs\/\$\{job\.id\}\/export-pdf`/ },
  { label: "legacy_export_payload_body", pattern: /\/export-(docx|pdf)[\s\S]{0,160}JSON\.stringify\(/ }
];

const requiredUiPatterns = [
  { label: "job_workspace_view_model", pattern: /jobWorkspaceViewModel\b/ },
  { label: "resume_view_model", pattern: /resumeViewModel\b/ },
  { label: "feedback_timeline_view", pattern: /feedbackTimelineView\b/ },
  { label: "execution_session_view", pattern: /executionSessionView\b/ },
  { label: "execution_dry_run_api", pattern: /\/execution\/dry-run\b/ },
  { label: "execution_confirm_api", pattern: /\/execution\/confirm\b/ },
  { label: "execution_submit_api", pattern: /\/execution\/submit\b/ },
  { label: "discovery_import_feishu_api", pattern: /\/api\/discovery\/intents\/\$\{targetIntentId\}\/import-feishu\b/ },
  { label: "discovery_sync_feishu_api", pattern: /\/api\/discovery\/intents\/\$\{targetIntentId\}\/sync-feishu-bitable\b/ },
  { label: "discovery_intent_api", pattern: /\/api\/discovery\/intents\b/ },
  { label: "discovery_view_route", pattern: /renderDiscovery\(/ },
  { label: "discovery_admin_route", pattern: /renderDiscoveryAdmin\(/ },
  { label: "discovery_lead_resolution_vm", pattern: /leadResolutionViewModel/ },
  { label: "discovery_lead_type_view", pattern: /leadType/ },
  { label: "discovery_routing_view", pattern: /routing/ },
  { label: "discovery_resolution_actions", pattern: /availableActions/ },
  { label: "master_resume_fetch_api", pattern: /api\("\/api\/master-resume"\)/ },
  { label: "master_resume_save_api", pattern: /api\("\/api\/master-resume",\s*\{/ },
  { label: "master_resume_form", pattern: /id="master-resume-form"/ },
  { label: "master_resume_view_model_usage", pattern: /masterResumeViewModel/ },
  { label: "master_resume_edit_dto_usage", pattern: /masterResumeEditDto/ },
  { label: "export_docx_download_api", pattern: /downloadFromApi\(\s*`\/api\/jobs\/\$\{job\.id\}\/export-docx`/ },
  { label: "export_pdf_download_api", pattern: /downloadFromApi\(\s*`\/api\/jobs\/\$\{job\.id\}\/export-pdf`/ },
  { label: "export_status_structured_view", pattern: /renderExportStatusCard\(/ }
];

function scanUiSource() {
  let failed = false;

  forbiddenUiPatterns.forEach((rule) => {
    if (rule.pattern.test(appJsSource)) {
      failed = true;
      console.error(`[validate-ui-boundary] forbidden UI pattern detected: ${rule.label}`);
    }
  });

  requiredUiPatterns.forEach((rule) => {
    if (!rule.pattern.test(appJsSource)) {
      failed = true;
      console.error(`[validate-ui-boundary] required UI pattern missing: ${rule.label}`);
    }
  });

  const discoveryViewSource = extractFunctionSource(appJsSource, "renderDiscovery");
  const forbiddenUserDiscoveryPatterns = [
    { label: "user_discovery_feishu_json_input", pattern: /discovery-feishu-json/ },
    { label: "user_discovery_feishu_form", pattern: /discovery-feishu-form/ },
    { label: "user_discovery_feishu_sync_form", pattern: /discovery-feishu-sync-form/ },
    { label: "user_discovery_apptoken", pattern: /\bappToken\b/ },
    { label: "user_discovery_tableid", pattern: /\btableId\b/ },
    { label: "user_discovery_tenant_token", pattern: /\btenantAccessToken\b/ },
    { label: "user_discovery_sync_api", pattern: /sync-feishu-bitable/ }
  ];
  forbiddenUserDiscoveryPatterns.forEach((rule) => {
    if (rule.pattern.test(discoveryViewSource)) {
      failed = true;
      console.error(`[validate-ui-boundary] forbidden user discovery pattern detected: ${rule.label}`);
    }
  });

  return failed;
}

function hasForbiddenKeys(payload, forbiddenKeys = [], pathPrefix = "root") {
  if (!payload || typeof payload !== "object") return [];

  const findings = [];
  const entries = Array.isArray(payload)
    ? payload.map((value, index) => [String(index), value])
    : Object.entries(payload);

  entries.forEach(([key, value]) => {
    const currentPath = `${pathPrefix}.${key}`;
    if (forbiddenKeys.includes(key)) {
      findings.push(currentPath);
    }
    if (value && typeof value === "object") {
      findings.push(...hasForbiddenKeys(value, forbiddenKeys, currentPath));
    }
  });

  return findings;
}

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) return "";

  let depth = 0;
  let seenBrace = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") {
      depth += 1;
      seenBrace = true;
    } else if (char === "}") {
      depth -= 1;
      if (seenBrace && depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return source.slice(start);
}

async function scanApiPayloads() {
  let failed = false;
  try {
    const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
    const resumePayload = orchestrator.getCurrentResume();
    const resumeForbidden = hasForbiddenKeys(resumePayload, [
      "resumeDocument",
      "resumeDocuments",
      "structuredProfile",
      "cleanedText",
      "rawText",
      "parseResult",
      "parserResult",
      "extractedText"
    ]);
    if (resumeForbidden.length) {
      failed = true;
      console.error("[validate-ui-boundary] forbidden keys detected in /api/resume payload:");
      resumeForbidden.forEach((item) => console.error(`  - ${item}`));
    }

    const requiredResumeKeys = ["resumeViewModel", "resumeMeta"];
    requiredResumeKeys.forEach((key) => {
      if (!(key in (resumePayload || {}))) {
        failed = true;
        console.error(`[validate-ui-boundary] missing required key in /api/resume payload: ${key}`);
      }
    });

    const requiredResumeMetaKeys = [
      "resumeId",
      "hasResume",
      "parseStatus",
      "parseQuality",
      "parseQualityScore",
      "uploadedAt",
      "warningCount"
    ];
    requiredResumeMetaKeys.forEach((key) => {
      if (!(key in ((resumePayload || {}).resumeMeta || {}))) {
        failed = true;
        console.error(`[validate-ui-boundary] missing required resumeMeta key in /api/resume payload: ${key}`);
      }
    });

    const masterResumePayload = orchestrator.getMasterResumeView();
    const masterResumeForbidden = hasForbiddenKeys(masterResumePayload, [
      "resumeDocument",
      "structuredProfile",
      "cleanedText",
      "rawText",
      "masterResume"
    ]);
    if (masterResumeForbidden.length) {
      failed = true;
      console.error("[validate-ui-boundary] forbidden keys detected in /api/master-resume payload:");
      masterResumeForbidden.forEach((item) => console.error(`  - ${item}`));
    }

    ["masterResumeViewModel", "masterResumeEditDto", "masterResumeMeta"].forEach((key) => {
      if (!(key in (masterResumePayload || {}))) {
        failed = true;
        console.error(`[validate-ui-boundary] missing required key in /api/master-resume payload: ${key}`);
      }
    });

    const list = await orchestrator.getJobWorkspaceList();
    const jobId = list?.jobWorkspaceViewModels?.[0]?.id;
    if (!jobId) {
      console.log("[validate-ui-boundary] no job found, skip runtime payload checks and fallback to static checks.");
      throw new Error("NO_JOB_DATA");
    }

    const detail = orchestrator.getJobDetailView(jobId);
    const detailForbidden = hasForbiddenKeys(detail, [
      "fitAssessment",
      "activityLogs",
      "resumeDocument",
      "structuredProfile",
      "cleanedText",
      "rawText",
      "feedbackTraces",
      "tailoringOutput",
      "diffView"
    ]);
    if (detailForbidden.length) {
      failed = true;
      console.error("[validate-ui-boundary] forbidden keys detected in /api/jobs/:id payload:");
      detailForbidden.forEach((item) => console.error(`  - ${item}`));
    }

    const workspace = await orchestrator.getOrBuildTailoringWorkspace(jobId);
    const workspaceForbidden = hasForbiddenKeys(workspace, [
      "fitAssessment",
      "activityLogs",
      "resumeDocument",
      "workspaceActivity",
      "operationData",
      "executionActions",
      "governanceView",
      "tailoringOutput",
      "workspace"
    ]);
    if (workspaceForbidden.length) {
      failed = true;
      console.error("[validate-ui-boundary] forbidden keys detected in /api/jobs/:id/tailoring-workspace payload:");
      workspaceForbidden.forEach((item) => console.error(`  - ${item}`));
    }

    const requiredDetailKeys = [
      "jobWorkspaceViewModel",
      "resumeViewModel",
      "feedbackTimelineView",
      "executionSessionView",
      "executionActions",
      "operationData",
      "governanceView"
    ];
    requiredDetailKeys.forEach((key) => {
      if (!(key in detail)) {
        failed = true;
        console.error(`[validate-ui-boundary] missing required key in /api/jobs/:id payload: ${key}`);
      }
    });

    const requiredOperationDataKeys = [
      "tailoredResumeContract",
      "tailoringDisplayView",
      "prepDto",
      "executionSessionView"
    ];
    requiredOperationDataKeys.forEach((key) => {
      if (!(key in (detail.operationData || {}))) {
        failed = true;
        console.error(`[validate-ui-boundary] missing required operationData key in /api/jobs/:id payload: ${key}`);
      }
    });

    const requiredWorkspaceKeys = [
      "jobWorkspaceViewModel",
      "resumeViewModel",
      "feedbackTimelineView",
      "tailoringWorkspaceViewModel",
      "tailoringWorkspaceEditDto"
    ];
    requiredWorkspaceKeys.forEach((key) => {
      if (!(key in workspace)) {
        failed = true;
        console.error(`[validate-ui-boundary] missing required key in tailoring-workspace payload: ${key}`);
      }
    });

    const discoveryIntent = orchestrator.createDiscoveryIntentWorkflow({
      keywords: ["ai pm"],
      city: "Shanghai",
      jobType: "full_time"
    });
    const discoveryIntentId = discoveryIntent?.intent?.intentId;
    if (!discoveryIntentId) {
      failed = true;
      console.error("[validate-ui-boundary] failed to create discovery intent for runtime checks.");
    } else {
      const discoveryImported = orchestrator.importDiscoveryFeishuLeadsWorkflow(discoveryIntentId, {
        docName: "validate-ui-boundary",
        leads: [
          {
            title: "AI Product Manager",
            company: "ApplyFlow Labs",
            location: "Shanghai",
            contentText:
              "招聘公告：AI Product Manager，负责 Agent 产品策略与交付，文本信息充足，可进入 ranking。",
            links: [{ url: "https://jobs.example.com/applyflow/pm", isPrimary: true }]
          },
          {
            title: "",
            company: "",
            location: "",
            contentText: "扫码投递，请使用小程序提交申请。",
            images: [{ name: "qr.png", note: "二维码" }]
          }
        ]
      });
      if (!discoveryImported?.leadProcessingResult) {
        failed = true;
        console.error("[validate-ui-boundary] discovery import did not return leadProcessingResult.");
      }
      const discoveryView = orchestrator.getDiscoveryIntentView(discoveryIntentId);
      const forbiddenDiscoveryKeys = hasForbiddenKeys(discoveryView, ["leadProcessingResult"]);
      if (forbiddenDiscoveryKeys.length) {
        failed = true;
        console.error("[validate-ui-boundary] forbidden keys detected in /api/discovery/intents/:id payload:");
        forbiddenDiscoveryKeys.forEach((item) => console.error(`  - ${item}`));
      }

      const requiredDiscoveryKeys = [
        "intent",
        "leadResolutionViewModel",
        "canonicalListings",
        "dedupCandidatePool",
        "batchDecisionResult",
        "rankingResult",
        "shortlistResult"
      ];
      requiredDiscoveryKeys.forEach((key) => {
        if (!(key in (discoveryView || {}))) {
          failed = true;
          console.error(`[validate-ui-boundary] missing required key in /api/discovery/intents/:id payload: ${key}`);
        }
      });
    }
  } catch (error) {
    const message = String(error?.message || "");
    console.log(`[validate-ui-boundary] runtime payload check skipped: ${message}`);
    const staticRequiredPatterns = [
      /function getJobDetailView\(/,
      /jobWorkspaceViewModel:/,
      /resumeViewModel:/,
      /feedbackTimelineView:/,
      /tailoringWorkspaceViewModel:/,
      /tailoringWorkspaceEditDto:/
    ];
    staticRequiredPatterns.forEach((pattern) => {
      if (!pattern.test(workflowControllerSource)) {
        failed = true;
        console.error(`[validate-ui-boundary] static boundary check failed for pattern: ${pattern}`);
      }
    });

    const tailoringWorkspaceSource = extractFunctionSource(workflowControllerSource, "buildTailoringWorkspace");
    const tailoringForbiddenStaticPatterns = [
      /executionActions:/,
      /operationData:/,
      /governanceView:/
    ];
    tailoringForbiddenStaticPatterns.forEach((pattern) => {
      if (pattern.test(tailoringWorkspaceSource)) {
        failed = true;
        console.error(`[validate-ui-boundary] static tailoring boundary violation: ${pattern}`);
      }
    });

    if (!/getJobDetailView\(jobId\)/.test(apiRoutesSource)) {
      failed = true;
      console.error("[validate-ui-boundary] /api/jobs/:id route is not wired to getJobDetailView.");
    }
    if (!/importDiscoveryFeishuLeadsWorkflow/.test(workflowControllerSource)) {
      failed = true;
      console.error("[validate-ui-boundary] discovery Feishu import workflow missing in controller.");
    }
    if (!/import-feishu/.test(apiRoutesSource)) {
      failed = true;
      console.error("[validate-ui-boundary] /api/discovery/intents/:id/import-feishu route missing.");
    }

    const getCurrentResumeSource = extractFunctionSource(workflowControllerSource, "getCurrentResume");
    const forbiddenResumeStaticPatterns = [
      /resumeDocument:/,
      /resumeDocuments:/
    ];
    forbiddenResumeStaticPatterns.forEach((pattern) => {
      if (pattern.test(getCurrentResumeSource)) {
        failed = true;
        console.error(`[validate-ui-boundary] static resume boundary violation: ${pattern}`);
      }
    });
  }

  const requiredExportRouteSnippets = [
    "export-docx$/.test(pathname)",
    "export-pdf$/.test(pathname)",
    "X-ApplyFlow-Export-Summary",
    "exportJobTailoringDocx",
    "exportJobTailoringPdf"
  ];
  requiredExportRouteSnippets.forEach((snippet) => {
    if (!apiRoutesSource.includes(snippet)) {
      failed = true;
      console.error(`[validate-ui-boundary] export route boundary missing snippet: ${snippet}`);
    }
  });

  return failed;
}

(async () => {
  const uiFailed = scanUiSource();
  const apiFailed = await scanApiPayloads();

  if (uiFailed || apiFailed) {
    process.exitCode = 1;
  } else {
    console.log("validate-ui-boundary: passed.");
  }
})();

const app = document.getElementById("app");
const title = document.getElementById("page-title");
const subtitle = document.getElementById("page-subtitle");
const currentUserLabel = document.getElementById("current-user");
const logoutButton = document.getElementById("logout-button");
let selectedPolicyProposalId = null;
let authSession = { authenticated: false, user: null };
const DEMO_AUTO_LOGIN_EMAIL = "eugene@example.com";
let autoLoginAttempted = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildImportWarningsHtml(warnings = []) {
  if (!warnings.length) return "";
  return `
    <div class="draft-warnings">
      ${warnings.map((warning) => `<div class="draft-warning-item">${escapeHtml(warning)}</div>`).join("")}
    </div>
  `;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!data.success) {
    const error = new Error(data.error?.message || "Request failed");
    error.code = data.error?.code;
    error.details = data.error?.details;
    throw error;
  }
  return data.data;
}

async function fetchAuthSession() {
  const response = await fetch("/api/auth/session", {
    headers: { "Content-Type": "application/json" }
  });
  const payload = await response.json();
  authSession = payload.data || { authenticated: false, user: null };
  updateAuthChrome();
  return authSession;
}

async function ensureDemoSession() {
  if (autoLoginAttempted) {
    return authSession;
  }
  autoLoginAttempted = true;
  renderLoadingState("Signing you in", "Creating a demo workspace session...");
  await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email: DEMO_AUTO_LOGIN_EMAIL })
  });
  return fetchAuthSession();
}

function updateAuthChrome() {
  if (!currentUserLabel || !logoutButton) return;
  if (authSession?.authenticated && authSession.user) {
    currentUserLabel.textContent = `Signed in as ${authSession.user.email || authSession.user.username || authSession.user.id}`;
    logoutButton.style.display = "inline-flex";
    return;
  }
  currentUserLabel.textContent = "Not signed in";
  logoutButton.style.display = "none";
}

function setActiveNav(route) {
  document.querySelectorAll(".nav a").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === route);
  });
}

function getStatusDisplayLabel(status) {
  const labels = {
    inbox: "Inbox",
    evaluating: "Evaluating",
    to_prepare: "Needs Prep",
    ready_to_apply: "Ready to Apply",
    applied: "Applied",
    follow_up: "Follow Up",
    interviewing: "Interviewing",
    rejected: "Rejected",
    offer: "Offer",
    archived: "Archived"
  };
  return labels[status] || status || "Unknown";
}

function statusBadge(status) {
  return `<span class="status ${status}">${escapeHtml(getStatusDisplayLabel(status))}</span>`;
}

function sectionCard(titleText, body) {
  return `<div class="card"><h3>${escapeHtml(titleText)}</h3>${body}</div>`;
}

function renderNotice(kind, message) {
  return `<div class="notice ${kind}">${escapeHtml(message)}</div>`;
}

function renderLoadingState(titleText = "Loading", bodyText = "Syncing the latest ApplyFlow workspace state...") {
  app.innerHTML = `
    <div class="loading-state">
      <div class="loading-dot"></div>
      <div>
        <h3>${escapeHtml(titleText)}</h3>
        <p>${escapeHtml(bodyText)}</p>
      </div>
    </div>
  `;
}

function semanticBadge(label, tone = "") {
  return `<span class="status ${tone}">${escapeHtml(label)}</span>`;
}

function formatPolicyVersion(policyLike) {
  if (!policyLike) return "Policy unavailable";
  return `${policyLike.id || "policy"}@${policyLike.version || 1}`;
}

function humanizeProposalStatus(status) {
  const map = {
    pending: { label: "Awaiting Review", tone: "pending" },
    approved: { label: "Approved", tone: "approved" },
    rejected: { label: "Rejected", tone: "rejected" },
    applied: { label: "Applied", tone: "applied" },
    reverted: { label: "Reverted", tone: "reverted" }
  };
  return map[status] || { label: status || "Unknown", tone: "" };
}

function humanizeStrategyDecision(value) {
  const map = {
    proceed: { label: "Proceed", helper: "Matches the current strategy and should stay active." },
    cautious_proceed: { label: "Proceed Carefully", helper: "Worth pursuing, but the role carries meaningful risk." },
    deprioritize: { label: "Lower Priority", helper: "Keep it visible, but do not let it crowd out stronger options." },
    avoid: { label: "Avoid", helper: "The system recommends stepping back unless you explicitly override it." }
  };
  return map[value] || { label: value || "Pending", helper: "Strategy guidance is still forming." };
}

function humanizeRecommendation(value) {
  const map = {
    apply: { label: "Strong Apply", tone: "applied" },
    cautious: { label: "Cautious Apply", tone: "to_prepare" },
    skip: { label: "Do Not Prioritize", tone: "archived" }
  };
  return map[value] || { label: value || "Pending", tone: "" };
}

function humanizeTriggerType(value) {
  const map = {
    interview_reflection: "Interview Reflection",
    bad_case: "Bad Case Review",
    metrics_shift: "Metrics Shift",
    manual_review: "Manual Review"
  };
  return map[value] || value || "Policy Proposal";
}

function humanizeFocusMode(value) {
  const map = {
    focused: "Focused",
    balanced: "Balanced",
    exploratory: "Exploratory"
  };
  return map[value] || value || "Balanced";
}

function humanizeRiskTolerance(value) {
  const map = {
    low: "Low",
    medium: "Medium",
    high: "High"
  };
  return map[value] || value || "Medium";
}

function humanizeOverride(value) {
  const map = {
    force_proceed: "Force proceed",
    ignore_policy: "Ignore policy guidance",
    force_archive: "Archive anyway"
  };
  return map[value] || value || "No override";
}

function humanizePriority(value) {
  const map = {
    high: "High Priority",
    medium: "Medium Priority",
    low: "Low Priority"
  };
  return map[value] || value || "Not set";
}

function humanizeAuditEvent(value) {
  const map = {
    proposal_created: "Proposal Created",
    proposal_approved: "Proposal Approved",
    proposal_rejected: "Proposal Rejected",
    policy_applied: "Policy Applied",
    policy_reverted: "Policy Reverted",
    user_override_applied: "User Override Applied"
  };
  return map[value] || value || "Audit Event";
}

function createJobViewModel({ job = {}, fitAssessment = null, nextAction = null } = {}) {
  const recommendationMeta = humanizeRecommendation(fitAssessment?.recommendation);
  const strategyMeta = humanizeStrategyDecision(fitAssessment?.strategyDecision || job.strategyDecision);
  const attentionFlags = [];

  if (job.policyOverride?.active) {
    attentionFlags.push({ key: "overridden", label: "Override active", tone: "offer" });
  }
  if ((fitAssessment?.strategyDecision || job.strategyDecision) === "avoid") {
    attentionFlags.push({ key: "avoid", label: "Avoid", tone: "archived" });
  } else if ((fitAssessment?.strategyDecision || job.strategyDecision) === "deprioritize") {
    attentionFlags.push({ key: "deprioritized", label: "Lower priority", tone: "evaluating" });
  } else if (job.priority === "high") {
    attentionFlags.push({ key: "boost", label: "Policy boost", tone: "ready_to_apply" });
  }

  return {
    id: job.id,
    company: job.company || "Unknown company",
    title: job.title || "Untitled role",
    location: job.location || "Location not specified",
    displayStatus: getStatusDisplayLabel(job.status),
    statusTone: job.status || "",
    priorityLabel: humanizePriority(job.priority),
    recommendationLabel: recommendationMeta.label,
    recommendationTone: recommendationMeta.tone,
    strategyLabel: strategyMeta.label,
    strategyHelper: strategyMeta.helper,
    fitScore: fitAssessment?.fitScore ?? job.fitScore ?? null,
    attentionFlags,
    nextActionSummary:
      nextAction?.title ||
      fitAssessment?.suggestedAction ||
      job.nextActionSummary ||
      "No recommended next step right now.",
    updatedAtText: job.updatedAt ? new Date(job.updatedAt).toLocaleString() : "Not updated yet",
    overrideSummary: job.policyOverride?.active
      ? `${humanizeOverride(job.policyOverride.action)}${job.policyOverride.reason ? ` · ${job.policyOverride.reason}` : ""}`
      : "",
    raw: job
  };
}

function createProposalViewModel(proposal = {}) {
  const statusMeta = humanizeProposalStatus(proposal.status);
  return {
    id: proposal.id,
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    triggerLabel: humanizeTriggerType(proposal.triggerType),
    reasonText: proposal.reasonSummary || "No reason summary.",
    diffSummaryText: (proposal.diffSummary || []).slice(0, 2).join(" ") || "No policy change summary.",
    createdAtText: proposal.createdAt ? new Date(proposal.createdAt).toLocaleString() : "n/a",
    reviewerNoteText: proposal.reviewerNote || "No reviewer note yet.",
    isActionable: proposal.status === "pending",
    oldPolicySnapshot: proposal.oldPolicySnapshot || {},
    proposedPolicySnapshot: proposal.proposedPolicySnapshot || {},
    diffSummary: proposal.diffSummary || [],
    triggerSourceId: proposal.triggerSourceId || "n/a",
    raw: proposal
  };
}

function createPolicyViewModel(policy = {}) {
  return {
    version: formatPolicyVersion(policy),
    focusModeLabel: humanizeFocusMode(policy.focusMode),
    riskToleranceLabel: humanizeRiskTolerance(policy.riskTolerance),
    preferredRolesSummary: (policy.preferredRoles || []).join(", ") || "still learning",
    riskyRolesSummary: (policy.riskyRoles || []).join(", ") || "none yet",
    shortSummaryText: policy.policySummary || "No active policy summary available yet.",
    preferredRolesCount: (policy.preferredRoles || []).length,
    riskyRolesCount: (policy.riskyRoles || []).length,
    lastUpdatedText: policy.lastUpdatedAt ? new Date(policy.lastUpdatedAt).toLocaleString() : "n/a",
    raw: policy
  };
}

function createAuditEventViewModel(event = {}) {
  return {
    id: event.id,
    eventLabel: humanizeAuditEvent(event.eventType || event.type || event.action),
    timeText: event.timestamp || event.createdAt ? new Date(event.timestamp || event.createdAt).toLocaleString() : "n/a",
    actorLabel: event.actor || event.agentName || "system",
    summaryText: event.summary || "No audit summary available.",
    relatedProposalId: event.relatedProposalId || event.policyProposalId || "",
    raw: event
  };
}

function createPrepViewModel({ prep = null, fitAssessment = null } = {}) {
  const checklist = prep?.checklist || [];
  const completedCount = checklist.filter((item) => item.completed).length;
  const isReady = completedCount >= 3;
  return {
    completionStatus: isReady ? "complete" : "in_progress",
    readinessLabel: isReady ? "Ready to apply" : "In progress",
    checklistProgress: `${completedCount}/${checklist.length}`,
    warningText: isReady
      ? ""
      : "请先完成简历、自我介绍和 Q&A 三项核心 checklist，再标记准备完成。",
    riskHint:
      fitAssessment?.strategyDecision === "cautious_proceed"
        ? `Proceed carefully: ${(fitAssessment.riskFlags || []).slice(0, 2).join(" / ") || "review fit risks"}`
        : "",
    completedCount,
    checklistCount: checklist.length,
    raw: prep
  };
}

function setButtonPending(button, pending, loadingLabel = "Working...") {
  if (!button) return;
  if (pending) {
    button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    button.classList.add("is-pending");
    button.textContent = loadingLabel;
    return;
  }
  button.disabled = false;
  button.classList.remove("is-pending");
  if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
  }
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function priorityWeight(priority) {
  return { high: 3, medium: 2, low: 1 }[priority] || 0;
}

function getStatusActionLabel(status) {
  const labels = {
    evaluating: "开始评估",
    to_prepare: "进入准备",
    ready_to_apply: "标记准备完成",
    applied: "标记已投递",
    follow_up: "进入跟进",
    interviewing: "进入面试中",
    rejected: "标记拒绝",
    offer: "标记 Offer",
    archived: "归档"
  };
  return labels[status] || status;
}

function buildPrepDraft(prep) {
  if (!prep) {
    return {
      targetKeywords: [],
      tailoredResumeBullets: "",
      tailoredSummary: "",
      whyMe: "",
      selfIntroShort: "",
      selfIntroMedium: "",
      qaDraft: "",
      coverNote: "",
      talkingPoints: "",
      outreachNote: "",
      checklist: [
        { key: "resume_reviewed", label: "简历改写已确认", completed: false },
        { key: "intro_ready", label: "自我介绍已确认", completed: false },
        { key: "qa_ready", label: "Q&A 草稿已确认", completed: false },
        { key: "talking_points_ready", label: "面试 talking points 已确认", completed: false },
        { key: "submit_ready", label: "投递路径已确认", completed: false }
      ]
    };
  }

  return {
    targetKeywords: prep.resumeTailoring?.targetKeywords || [],
    tailoredResumeBullets: (prep.resumeTailoring?.rewriteBullets || [])
      .map((item) => item.rewritten)
      .join("\n"),
    tailoredSummary: prep.tailoredSummary || "",
    whyMe: prep.whyMe || "",
    selfIntroShort: prep.selfIntro?.short || "",
    selfIntroMedium: prep.selfIntro?.medium || "",
    qaDraft: (prep.qaDraft || [])
      .map((item) => `${item.question} :: ${item.draftAnswer}`)
      .join("\n"),
    coverNote: prep.coverNote || "",
    talkingPoints: (prep.talkingPoints || []).join("\n"),
    outreachNote: prep.outreachNote || "",
    checklist: prep.checklist || []
  };
}

function renderLoginScreen(message = "", errorMessage = "", users = []) {
  setActiveNav("");
  title.textContent = "Sign In";
  subtitle.textContent = "Choose a test identity to open a user-scoped ApplyFlow workspace.";
  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="card">
      <div class="section-head">
        <div>
          <div class="eyebrow">Authentication</div>
          <h3>Open a workspace</h3>
        </div>
      </div>
      <form id="login-form" class="stack">
        <label>Email or username
          <input name="login" placeholder="alex@example.com / taylor@example.com" />
        </label>
        <div class="toolbar">
          <button class="button primary" type="submit">Sign in</button>
        </div>
      </form>
      <div class="stack" style="margin-top:16px;">
        ${
          users.length
            ? users
                .map(
                  (user) => `
                    <button class="button" type="button" data-dev-login="${escapeHtml(user.email || user.username || user.id)}">
                      Use ${escapeHtml(user.email || user.username || user.id)}
                    </button>
                  `
                )
                .join("")
            : `<div class="empty">No test users are available.</div>`
        }
      </div>
    </div>
  `;

  const submitLogin = async (login) => {
    try {
      const button = document.querySelector('#login-form button[type="submit"]');
      setButtonPending(button, true, "Signing in...");
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ login })
      });
      await fetchAuthSession();
      window.location.hash = "#/dashboard";
      await renderDashboard("Signed in successfully.");
    } catch (error) {
      renderLoginScreen("", error.message, users);
    }
  };

  document.getElementById("login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    await submitLogin(String(formData.get("login") || ""));
  });

  document.querySelectorAll("[data-dev-login]").forEach((button) => {
    button.addEventListener("click", async () => {
      await submitLogin(button.getAttribute("data-dev-login"));
    });
  });
}

async function renderUnauthenticatedWorkspace(errorMessage = "") {
  app.innerHTML = `
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="panel">
      <h3>Please sign in</h3>
      <p>ApplyFlow needs a workspace session before it can load your dashboard.</p>
    </div>
  `;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildPolicyDelta(label, oldValues, newValues) {
  const previous = ensureArray(oldValues);
  const next = ensureArray(newValues);
  const added = next.filter((item) => !previous.includes(item));
  const removed = previous.filter((item) => !next.includes(item));

  if (!added.length && !removed.length) {
    return "";
  }

  return `
    <div class="panel">
      <strong>${escapeHtml(label)}</strong>
      ${added.length ? `<div class="muted">Added: ${escapeHtml(added.join(", "))}</div>` : ""}
      ${removed.length ? `<div class="muted">Removed: ${escapeHtml(removed.join(", "))}</div>` : ""}
    </div>
  `;
}

async function renderDashboard(message = "", errorMessage = "") {
  setActiveNav("#/dashboard");
  title.textContent = "Dashboard";
  subtitle.textContent = "从待办、状态和优先级快速查看当前求职推进情况。";
  renderLoadingState("Loading dashboard", "Pulling pipeline, strategy and activity signals into the workbench...");
  const data = await api("/api/dashboard/summary");
  const policyVm = createPolicyViewModel(data.globalPolicy);
  const proposalVms = (data.policyProposals || []).map((proposal) => createProposalViewModel(proposal));
  const auditVms = (data.policyAuditLogs || []).map((entry) => createAuditEventViewModel(entry));
  const recentJobVms = (data.recentJobs || []).map((job) =>
    createJobViewModel({
      job,
      fitAssessment: {
        fitScore: job.fitScore,
        recommendation: job.recommendation,
        strategyDecision: job.strategyDecision
      }
    })
  );

  const statusCards = Object.entries(data.statusCounts)
    .map(
      ([key, value]) => `
        <div class="metric-card">
          <div class="metric-label">${escapeHtml(key)}</div>
          <div class="metric">${value}</div>
          <div class="metric-support">pipeline status</div>
        </div>
      `
    )
    .join("");
  const metricsCards = [
    { label: "Total Jobs", value: data.metrics.totalJobs },
    { label: "Applied", value: data.metrics.appliedJobs },
    { label: "Interviewing+", value: data.metrics.interviewJobs },
    { label: "Offers", value: data.metrics.offers },
    { label: "Conversion", value: formatPercent(data.metrics.conversionRate) },
    { label: "Prep Completion", value: formatPercent(data.metrics.prepCompletionRate) }
  ]
    .map(
      (metric) => `
        <div class="metric-card">
          <div class="metric-label">${escapeHtml(metric.label)}</div>
          <div class="metric">${escapeHtml(metric.value)}</div>
          <div class="metric-support">live store metric</div>
        </div>
      `
    )
    .join("");

  const priorityRoles =
    data.globalPolicy?.preferredRoles ||
    data.globalPolicy?.targetRolesPriority ||
    data.strategyInsights?.policySignals?.targetRolesPriority ||
    [];
  const strategyRecommendations = (data.strategyInsights?.recommendations || []).slice(0, 2);
  const pendingProposals = (data.policyProposals || []).filter((proposal) => proposal.status === "pending").length;
  const primaryTodo = data.todoTasks[0];
  const staleJob = data.staleJobs[0];

  const todoList =
    data.todoTasks.length === 0
      ? `<div class="empty">当前没有待办任务。</div>`
      : `<div class="stack">${data.todoTasks
          .slice(0, 4)
          .map((task) => `
              <div class="panel">
                <strong>${escapeHtml(task.title)}</strong>
                <div class="muted">${escapeHtml(task.note || "")}</div>
              </div>
            `)
          .join("")}</div>`;

  const recentJobs =
    recentJobVms.length === 0
      ? `<div class="empty">暂无岗位。</div>`
      : `<table class="table">
          <thead><tr><th>Company</th><th>Role</th><th>Status</th><th>Fit</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            ${recentJobVms
              .map(
                (jobVm) => `
                  <tr>
                    <td>${escapeHtml(jobVm.company)}</td>
                    <td>${escapeHtml(jobVm.title)}</td>
                    <td>${statusBadge(jobVm.raw.status)}</td>
                    <td>${escapeHtml(jobVm.fitScore ?? "-")}</td>
                    <td>${escapeHtml(jobVm.updatedAtText)}</td>
                    <td><a class="button" href="#/jobs/${jobVm.id}">查看</a></td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>`;

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="dashboard-shell">
      <section class="dashboard-hero">
        <div class="hero-copy">
          <div class="eyebrow">ApplyFlow Workbench</div>
          <h3 class="hero-title">让今天的求职推进更清楚，而不是更分散。</h3>
          <p class="hero-subtitle">这个工作台把待办、策略和最近岗位收束到同一屏，让你先处理最该推进的下一步。</p>
          <div class="hero-meta">
            ${statusBadge(data.strategyInsights?.strategyHealth || "forming")}
            <span class="status">focus · ${escapeHtml(policyVm.focusModeLabel)}</span>
            <span class="status">risk · ${escapeHtml(policyVm.riskToleranceLabel)}</span>
            <span class="status">policy · ${escapeHtml(policyVm.version)}</span>
          </div>
          <div class="toolbar">
            <a class="button primary" href="#/jobs/new">New Job</a>
            <a class="button" href="#/jobs">Open Jobs</a>
            <a class="button" href="#/profile">Profile</a>
          </div>
        </div>
        <div class="stack">
          <div class="card surface-dark">
            <div class="eyebrow">Today</div>
            <h4>${escapeHtml(primaryTodo?.title || "No urgent task queued")}</h4>
            <p class="muted">${escapeHtml(primaryTodo?.note || "You can use this quiet window to review strategy and add a new job.")}</p>
          </div>
          <div class="split-metrics">
            <div class="metric-card">
              <div class="metric-label">Pending Proposals</div>
              <div class="metric">${pendingProposals}</div>
              <div class="metric-support">policy governance</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">Priority Roles</div>
              <div class="metric">${escapeHtml(priorityRoles.slice(0, 2).join(", ") || "Learning")}</div>
              <div class="metric-support">global policy signal</div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <div>
            <div class="eyebrow">Metrics</div>
            <h3>Pipeline snapshot</h3>
          </div>
        </div>
        <div class="grid cards-3">${metricsCards}</div>
      </section>

      <section>
        <div class="section-head">
          <div>
            <div class="eyebrow">Workbench</div>
            <h3>Today and next action</h3>
          </div>
        </div>
        <div class="workbench-grid">
          <div class="stack">
            <div class="card">
              <div class="section-head">
                <div>
                  <div class="eyebrow">Today</div>
                  <h3>Active queue</h3>
                </div>
              </div>
              ${todoList}
            </div>
            <div class="card">
              <div class="section-head">
                <div>
                  <div class="eyebrow">Attention</div>
                  <h3>Needs follow-through</h3>
                </div>
              </div>
              ${
                data.staleJobs.length
                  ? `<div class="stack">${data.staleJobs
                      .slice(0, 4)
                      .map(
                        (job) => `
                          <div class="panel">
                            <strong>${escapeHtml(job.company)} · ${escapeHtml(job.title)}</strong>
                            <div class="inline-meta">
                              ${statusBadge(job.status)}
                              <span class="muted">${new Date(job.updatedAt).toLocaleString()}</span>
                            </div>
                          </div>
                        `
                      )
                      .join("")}</div>`
                  : `<div class="empty">当前没有卡住的关键岗位。</div>`
              }
              ${
                staleJob
                  ? `<div class="notice warning">建议优先处理 ${escapeHtml(staleJob.company)} / ${escapeHtml(staleJob.title)}，它已经在队列里停留较久。</div>`
                  : ""
              }
            </div>
          </div>

          <div class="stack">
            <div class="card">
              <div class="section-head">
                <div>
                  <div class="eyebrow">Strategy</div>
                  <h3>Global focus</h3>
                </div>
              </div>
              ${
                strategyRecommendations.length
                  ? `<div class="stack">${strategyRecommendations
                      .map((item) => `<div class="panel"><strong>Recommendation</strong><div class="muted">${escapeHtml(item)}</div></div>`)
                      .join("")}</div>`
                  : `<div class="empty">Strategy insight will appear after more outcomes are recorded.</div>`
              }
              <div class="panel">
                <strong>Policy summary</strong>
                <div class="muted">${escapeHtml(data.globalPolicy?.policySummary || "The system is still learning the best pipeline policy.")}</div>
                <div class="muted">Concentration: ${escapeHtml(data.strategyInsights?.concentrationScore || "medium")}</div>
                <div class="muted">Drift: ${escapeHtml(data.strategyInsights?.driftStatus || "aligned")}</div>
              </div>
              <div class="panel">
                <strong>Preferred / Risky Roles</strong>
                <div class="muted">Prefer: ${escapeHtml((data.strategyInsights?.preferredRoles || []).join(", ") || "still learning")}</div>
                <div class="muted">Reduce: ${escapeHtml((data.strategyInsights?.riskyRoles || []).join(", ") || "none yet")}</div>
              </div>
            </div>

            <div class="card">
              <div class="section-head">
                <div>
                  <div class="eyebrow">Governance</div>
                  <h3>Policy review</h3>
                </div>
              </div>
              <div class="panel">
                <strong>Active Policy</strong>
                <div class="muted">Version: ${escapeHtml(`${data.globalPolicy?.id || "policy"}@${data.globalPolicy?.version || 1}`)}</div>
                <div class="muted">${escapeHtml(policyVm.shortSummaryText)}</div>
                <div class="toolbar" style="margin-top:8px;">
                  <button class="button" id="policy-revert-btn">Revert Policy</button>
                </div>
              </div>
              ${
                proposalVms.length
                  ? proposalVms
                      .slice(0, 3)
                      .map(
                        (proposalVm) => `
                          <div class="panel">
                            <strong>${escapeHtml(proposalVm.triggerLabel)}</strong>
                            <div class="inline-meta">
                              ${semanticBadge(proposalVm.statusLabel, proposalVm.statusTone)}
                              <span class="muted">${escapeHtml(proposalVm.createdAtText)}</span>
                            </div>
                            <div class="muted">${escapeHtml(proposalVm.reasonText)}</div>
                            <div class="muted">${escapeHtml(proposalVm.diffSummaryText)}</div>
                            <div class="toolbar" style="margin-top:8px;">
                              ${
                                proposalVm.isActionable
                                  ? `
                                    <button class="button" data-proposal-action="approve" data-proposal-id="${proposalVm.id}">Approve</button>
                                    <button class="button" data-proposal-action="reject" data-proposal-id="${proposalVm.id}">Reject</button>
                                  `
                                  : `<span class="muted">Current state: ${escapeHtml(proposalVm.statusLabel)}</span>`
                              }
                            </div>
                          </div>
                        `
                      )
                      .join("")
                  : `<div class="empty">No policy proposals pending review.</div>`
              }
              <div class="panel">
                <strong>Recent Audit</strong>
                ${
                  auditVms.length
                    ? auditVms
                        .slice(0, 3)
                        .map((entryVm) => `<div class="muted">${escapeHtml(entryVm.eventLabel)} · ${escapeHtml(entryVm.summaryText)}</div>`)
                        .join("")
                    : '<div class="muted">No policy audit events yet.</div>'
                }
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <div>
            <div class="eyebrow">Recent Jobs</div>
            <h3>Latest pipeline movement</h3>
          </div>
        </div>
        <div class="card table-shell">${recentJobs}</div>
      </section>

      <section>
        <div class="section-head">
          <div>
            <div class="eyebrow">Status</div>
            <h3>Pipeline distribution</h3>
          </div>
        </div>
        <div class="grid cards-3">${statusCards}</div>
      </section>
    </div>
  `;

  const revertBtn = document.getElementById("policy-revert-btn");
  if (revertBtn) {
    revertBtn.addEventListener("click", async () => {
      if (!window.confirm("Revert the currently active policy?")) {
        return;
      }
      try {
        setButtonPending(revertBtn, true, "Reverting...");
        await api("/api/policy/revert", { method: "POST" });
        renderDashboard("Policy 已回滚。");
      } catch (error) {
        setButtonPending(revertBtn, false);
        renderDashboard("", error.message);
      }
    });
  }

  document.querySelectorAll("[data-proposal-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const proposalId = button.getAttribute("data-proposal-id");
      const action = button.getAttribute("data-proposal-action");
      const confirmed = window.confirm(`${action === "approve" ? "Approve" : "Reject"} this policy proposal?`);
      if (!confirmed) return;
      const reviewerNote = window.prompt("Reviewer note（可选）", "") || "";
      try {
        setButtonPending(button, true, action === "approve" ? "Approving..." : "Rejecting...");
        await api(`/api/policy/proposals/${proposalId}/${action}`, {
          method: "POST",
          body: JSON.stringify({ reviewerNote })
        });
        renderDashboard(`Proposal ${action} 完成。`);
      } catch (error) {
        setButtonPending(button, false);
        renderDashboard("", error.message);
      }
    });
  });
}

async function renderGovernance(message = "", errorMessage = "") {
  setActiveNav("#/governance");
  title.textContent = "Policy Governance";
  subtitle.textContent = "查看 active policy、review proposals，并追踪治理历史。";
  renderLoadingState("Loading governance", "Refreshing policy, proposal and audit records...");

  const [currentData, proposalData, historyData] = await Promise.all([
    api("/api/policy/current"),
    api("/api/policy/proposals"),
    api("/api/policy/history")
  ]);

  const policyVm = createPolicyViewModel(currentData.policy || {});
  const auditVms = (currentData.auditLogs || proposalData.auditLogs || []).map((entry) => createAuditEventViewModel(entry));
  const proposalVms = [...(proposalData.proposals || []).map((proposal) => createProposalViewModel(proposal))].sort(
    (a, b) => new Date(b.raw.createdAt) - new Date(a.raw.createdAt)
  );
  const pendingProposals = proposalVms.filter((proposal) => proposal.raw.status === "pending");
  const reviewProposals = pendingProposals.length ? pendingProposals : proposalVms;

  if (!selectedPolicyProposalId || !reviewProposals.some((proposal) => proposal.id === selectedPolicyProposalId)) {
    selectedPolicyProposalId = reviewProposals[0]?.id || proposalVms[0]?.id || null;
  }

  const selectedProposal =
    proposalVms.find((proposal) => proposal.id === selectedPolicyProposalId) ||
    proposalVms[0] ||
    null;
  const previousPolicy = createPolicyViewModel(selectedProposal?.oldPolicySnapshot || {});
  const proposedPolicy = createPolicyViewModel(selectedProposal?.proposedPolicySnapshot || {});
  const changedFocusMode = previousPolicy.focusModeLabel !== proposedPolicy.focusModeLabel;
  const changedRiskTolerance = previousPolicy.riskToleranceLabel !== proposedPolicy.riskToleranceLabel;

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="governance-shell">
      <section class="governance-hero">
        <div class="hero-copy">
          <div class="eyebrow">Active Policy</div>
          <h3 class="hero-title">${escapeHtml(policyVm.version)}</h3>
          <p class="hero-subtitle">${escapeHtml(policyVm.shortSummaryText)}</p>
          <div class="hero-meta">
            <span class="status">Focus · ${escapeHtml(policyVm.focusModeLabel)}</span>
            <span class="status">Risk tolerance · ${escapeHtml(policyVm.riskToleranceLabel)}</span>
            <span class="status">Preferred roles · ${escapeHtml(policyVm.preferredRolesCount)}</span>
            <span class="status">Risky roles · ${escapeHtml(policyVm.riskyRolesCount)}</span>
          </div>
          <div class="toolbar">
            <button class="button" id="policy-revert-btn">Revert Active Policy</button>
          </div>
        </div>
        <div class="stack">
          <div class="panel">
            <strong>Preferred / Risky Roles</strong>
            <div class="muted">Prefer: ${escapeHtml(policyVm.preferredRolesSummary)}</div>
            <div class="muted">Reduce: ${escapeHtml(policyVm.riskyRolesSummary)}</div>
          </div>
          <div class="panel">
            <strong>Governance Snapshot</strong>
            <div class="muted">Pending proposals: ${pendingProposals.length}</div>
            <div class="muted">Last updated: ${escapeHtml(policyVm.lastUpdatedText)}</div>
            <div class="muted">Recent policy evolutions: ${historyData.history?.length || 0}</div>
          </div>
        </div>
      </section>

      <section class="governance-main">
        <div class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">Pending Proposals</div>
              <h3>Review rail</h3>
            </div>
            <div class="muted">${pendingProposals.length ? `${pendingProposals.length} pending` : "No pending proposal, showing latest changes"}</div>
          </div>
          ${
            proposalVms.length
              ? `<div class="proposal-list">${reviewProposals
                  .map(
                    (proposalVm) => `
                      <div class="proposal-item ${proposalVm.id === selectedPolicyProposalId ? "selected" : ""}" data-select-proposal="${proposalVm.id}" tabindex="0" role="button" aria-label="Open proposal ${escapeHtml(proposalVm.id)}">
                        <div class="proposal-topline">
                          <strong>${escapeHtml(proposalVm.triggerLabel)}</strong>
                          ${semanticBadge(proposalVm.statusLabel, proposalVm.statusTone)}
                        </div>
                        <div class="muted">${escapeHtml(proposalVm.createdAtText)}</div>
                        <div>${escapeHtml(proposalVm.reasonText)}</div>
                        <div class="muted">${escapeHtml(proposalVm.diffSummaryText)}</div>
                        <div class="toolbar proposal-actions">
                          <span class="text-link">View diff</span>
                          ${
                            proposalVm.isActionable
                              ? `
                                <button type="button" class="button primary" data-proposal-action="approve" data-proposal-id="${proposalVm.id}">Approve</button>
                                <button type="button" class="button" data-proposal-action="reject" data-proposal-id="${proposalVm.id}">Reject</button>
                              `
                              : `<span class="muted">Current state: ${escapeHtml(proposalVm.statusLabel)}</span>`
                          }
                        </div>
                      </div>
                    `
                  )
                  .join("")}</div>`
              : `<div class="empty">No policy proposals recorded yet.</div>`
          }
        </div>

        <div class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">Policy Diff</div>
              <h3>Explainability</h3>
            </div>
            ${selectedProposal ? `<div class="muted">selected ${escapeHtml(selectedProposal.id)}</div>` : ""}
          </div>
          ${
            selectedProposal
              ? `
                <div class="panel">
                  <strong>${escapeHtml(selectedProposal.reasonText || "Policy change proposal")}</strong>
                  <div class="muted">Trigger: ${escapeHtml(selectedProposal.triggerLabel || "manual_review")} · Source: ${escapeHtml(selectedProposal.triggerSourceId || "n/a")}</div>
                  <div class="muted">${escapeHtml(selectedProposal.reviewerNoteText)}</div>
                </div>
                <div class="info-grid">
                  <div class="panel">
                    <strong>Old policy</strong>
                    <div class="muted">${escapeHtml(previousPolicy.version)}</div>
                    <div class="muted">Focus mode: ${escapeHtml(previousPolicy.focusModeLabel || "unset")}</div>
                    <div class="muted">Risk tolerance: ${escapeHtml(previousPolicy.riskToleranceLabel || "unset")}</div>
                  </div>
                  <div class="panel">
                    <strong>Proposed policy</strong>
                    <div class="muted">${escapeHtml(proposedPolicy.version)}</div>
                    <div class="muted">Focus mode: ${escapeHtml(proposedPolicy.focusModeLabel || "unset")}</div>
                    <div class="muted">Risk tolerance: ${escapeHtml(proposedPolicy.riskToleranceLabel || "unset")}</div>
                  </div>
                </div>
                <div class="stack">
                  ${buildPolicyDelta("Preferred Roles", previousPolicy.raw.preferredRoles, proposedPolicy.raw.preferredRoles)}
                  ${buildPolicyDelta("Risky Roles", previousPolicy.raw.riskyRoles, proposedPolicy.raw.riskyRoles)}
                  ${buildPolicyDelta("Success Patterns", previousPolicy.raw.successPatterns, proposedPolicy.raw.successPatterns)}
                  ${buildPolicyDelta("Failure Patterns", previousPolicy.raw.failurePatterns, proposedPolicy.raw.failurePatterns)}
                  ${buildPolicyDelta("Avoid Patterns", previousPolicy.raw.avoidPatterns, proposedPolicy.raw.avoidPatterns)}
                  ${
                    changedFocusMode
                      ? `<div class="panel"><strong>Focus Mode</strong><div class="muted">Changed from ${escapeHtml(previousPolicy.focusModeLabel || "unset")} to ${escapeHtml(proposedPolicy.focusModeLabel || "unset")}.</div></div>`
                      : ""
                  }
                  ${
                    changedRiskTolerance
                      ? `<div class="panel"><strong>Risk Tolerance</strong><div class="muted">Changed from ${escapeHtml(previousPolicy.riskToleranceLabel || "unset")} to ${escapeHtml(proposedPolicy.riskToleranceLabel || "unset")}.</div></div>`
                      : ""
                  }
                  <div class="panel">
                    <strong>Why this change is being proposed</strong>
                    ${(selectedProposal.diffSummary || [])
                      .map((item) => `<div class="muted">${escapeHtml(item)}</div>`)
                      .join("") || '<div class="muted">No readable diff explanation is available yet.</div>'}
                  </div>
                </div>
              `
              : `<div class="empty">Select a policy proposal to inspect the diff and rationale.</div>`
          }
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">Audit History</div>
            <h3>Governance timeline</h3>
          </div>
          <div class="muted">Recent policy actions and overrides</div>
        </div>
        ${
          auditVms.length
            ? `<div class="timeline">${auditVms
                .slice()
                .sort((a, b) => new Date(b.raw.timestamp || b.raw.createdAt) - new Date(a.raw.timestamp || a.raw.createdAt))
                .map(
                  (entryVm) => `
                    <div class="timeline-item">
                      <div class="timeline-dot"></div>
                      <div class="timeline-content">
                        <div class="timeline-meta">
                          <strong>${escapeHtml(entryVm.eventLabel)}</strong>
                          <span class="muted">${escapeHtml(entryVm.timeText)}</span>
                        </div>
                        <div>${escapeHtml(entryVm.summaryText)}</div>
                        <div class="inline-meta">
                          <span class="muted">actor · ${escapeHtml(entryVm.actorLabel)}</span>
                          ${entryVm.relatedProposalId ? `<span class="muted">proposal · ${escapeHtml(entryVm.relatedProposalId)}</span>` : ""}
                        </div>
                      </div>
                    </div>
                  `
                )
                .join("")}</div>`
            : `<div class="empty">No audit history yet.</div>`
        }
      </section>
    </div>
  `;

  const revertBtn = document.getElementById("policy-revert-btn");
  if (revertBtn) {
    revertBtn.addEventListener("click", async () => {
      const confirmed = window.confirm("Revert the active policy to the previous snapshot?");
      if (!confirmed) return;
      try {
        setButtonPending(revertBtn, true, "Reverting...");
        await api("/api/policy/revert", { method: "POST" });
        renderGovernance("Policy 已回滚。");
      } catch (error) {
        setButtonPending(revertBtn, false);
        renderGovernance("", error.message);
      }
    });
  }

  document.querySelectorAll("[data-select-proposal]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const actionTarget = event.target.closest("[data-proposal-action]");
      if (actionTarget) {
        return;
      }
      selectedPolicyProposalId = button.getAttribute("data-select-proposal");
      renderGovernance(message, errorMessage);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectedPolicyProposalId = button.getAttribute("data-select-proposal");
      renderGovernance(message, errorMessage);
    });
  });

  document.querySelectorAll("[data-proposal-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const proposalId = button.getAttribute("data-proposal-id");
      const action = button.getAttribute("data-proposal-action");
      const confirmed = window.confirm(`${action === "approve" ? "Approve" : "Reject"} this policy proposal?`);
      if (!confirmed) return;
      const reviewerNote = window.prompt("Reviewer note（可选）", "") || "";
      try {
        setButtonPending(button, true, action === "approve" ? "Approving..." : "Rejecting...");
        await api(`/api/policy/proposals/${proposalId}/${action}`, {
          method: "POST",
          body: JSON.stringify({ reviewerNote })
        });
        selectedPolicyProposalId = proposalId;
        renderGovernance(`Proposal ${action} 完成。`);
      } catch (error) {
        setButtonPending(button, false);
        renderGovernance("", error.message);
      }
    });
  });
}

async function renderJobs(message = "") {
  setActiveNav("#/jobs");
  title.textContent = "Jobs";
  subtitle.textContent = "集中查看岗位、匹配分、状态和更新时间。";
  renderLoadingState("Loading jobs", "Refreshing your pipeline queue and latest job signals...");
  const data = await api("/api/jobs");
  const jobs = [...data.jobs].sort(
    (a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || new Date(b.updatedAt) - new Date(a.updatedAt)
  );
  const activeJobs = jobs.filter((job) => job.status !== "archived").length;
  const boostedJobs = jobs.filter((job) => job.priority === "high" && job.strategyDecision !== "avoid").length;
  const deprioritizedJobs = jobs.filter((job) => job.strategyDecision === "deprioritize" || job.strategyDecision === "avoid").length;

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    <div class="jobs-shell">
      <section class="jobs-hero">
        <div class="hero-copy">
          <div class="eyebrow">Jobs Queue</div>
          <h3 class="hero-title">把岗位列表变成一个可扫描、可取舍的推进队列。</h3>
          <p class="hero-subtitle">先看最值得推进的岗位，再识别被 policy boost、deprioritize 或 avoid 的对象。</p>
          <div class="toolbar">
            <a class="button primary" href="#/jobs/new">新增岗位</a>
          </div>
        </div>
        <div class="split-metrics">
          <div class="metric-card">
            <div class="metric-label">Active Jobs</div>
            <div class="metric">${activeJobs}</div>
            <div class="metric-support">currently in pipeline</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Policy Boost</div>
            <div class="metric">${boostedJobs}</div>
            <div class="metric-support">high-priority roles</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Deprioritized</div>
            <div class="metric">${deprioritizedJobs}</div>
            <div class="metric-support">needs caution</div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">Queue</div>
            <h3>Priority-aware job list</h3>
          </div>
          <div class="muted">按 priority 与最近更新时间排序</div>
        </div>
        <div class="table-shell jobs-table-shell">
          <table class="table jobs-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Fit</th>
                <th>Recommendation</th>
                <th>Strategy</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${jobs
                .map((job) => {
                  const fit = data.fitAssessments.find((item) => item.jobId === job.id);
                  const recommendation = humanizeRecommendation(fit?.recommendation);
                  const strategy = humanizeStrategyDecision(fit?.strategyDecision || job.strategyDecision);
                  const attentionBadge =
                    job.policyOverride?.active
                      ? '<span class="status offer">Override active</span>'
                      : job.strategyDecision === "avoid"
                        ? '<span class="status archived">Avoid</span>'
                        : job.strategyDecision === "deprioritize"
                          ? '<span class="status evaluating">Lower priority</span>'
                          : job.priority === "high"
                            ? '<span class="status ready_to_apply">Policy boost</span>'
                            : "";

                  return `
                    <tr class="jobs-row">
                      <td>
                        <div class="job-primary">
                          <strong>${escapeHtml(job.company)}</strong>
                          <div>${escapeHtml(job.title)}</div>
                          <div class="inline-meta">
                            <span class="muted">${escapeHtml(job.location)}</span>
                            ${attentionBadge}
                          </div>
                        </div>
                      </td>
                      <td>${statusBadge(job.status)}</td>
                      <td><span class="status">${escapeHtml(humanizePriority(job.priority))}</span></td>
                      <td><strong>${fit ? fit.fitScore : "-"}</strong></td>
                      <td>${fit ? semanticBadge(recommendation.label, recommendation.tone) : '<span class="muted">Awaiting evaluation</span>'}</td>
                      <td><span title="${escapeHtml(strategy.helper)}">${escapeHtml(strategy.label)}</span></td>
                      <td><span class="muted">${new Date(job.updatedAt).toLocaleString()}</span></td>
                      <td><a class="button" href="#/jobs/${job.id}">Open</a></td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

async function renderNewJob() {
  setActiveNav("#/jobs");
  title.textContent = "New Job";
  subtitle.textContent = "先导入或填写岗位草稿，再确认创建并自动进入评估。";
  app.innerHTML = `
    <div class="panel">
      <div class="draft-header">
        <div>
          <div class="eyebrow">Job Intake</div>
          <h3>从 JD 文本或职位链接开始，先拿到一个可编辑草稿。</h3>
          <p class="muted">ApplyFlow 会尽量从 URL 提取结构化内容；如果失败，你仍然可以补字段或粘贴 JD 继续创建。</p>
          <p class="muted">Tip: 评估结果会读取你的 Profile；如果你还没完善画像，先去 <a href="#/profile">Profile</a> 更新会更准确。</p>
        </div>
      </div>
      <form id="new-job-form" class="stack">
        <div class="split">
          <label>Company<input name="company" /></label>
          <label>Title<input name="title" /></label>
        </div>
        <div class="split">
          <label>Location<input name="location" /></label>
          <label>Source Platform<input name="sourcePlatform" value="Manual" /></label>
        </div>
        <label>Job URL<input name="jobUrl" /></label>
        <label>Raw JD Text<textarea name="rawJdText" placeholder="Paste the job description here. You can also leave this short and fill manual fields."></textarea></label>
        <div class="toolbar">
          <button class="button" type="button" id="import-job-url">从 URL 导入草稿</button>
          <button class="button primary" type="submit">确认创建并评估岗位</button>
        </div>
      </form>
      <div id="job-draft-preview"></div>
      <div id="page-feedback"></div>
    </div>
  `;

  const formElement = document.getElementById("new-job-form");
  const feedback = document.getElementById("page-feedback");
  const preview = document.getElementById("job-draft-preview");
  const importButton = document.getElementById("import-job-url");

  importButton.addEventListener("click", async () => {
    feedback.innerHTML = "";
    preview.innerHTML = "";
    try {
      setButtonPending(importButton, true, "导入中...");
      const formData = new FormData(formElement);
      const payload = Object.fromEntries(formData.entries());
      if (!String(payload.jobUrl || "").trim()) {
        throw new Error("请先输入职位 URL。");
      }
      const data = await api("/api/jobs/import-url", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const draft = data.draft || {};
      const draftFields = ["company", "title", "location", "sourceLabel", "jobUrl", "rawJdText"];
      draftFields.forEach((field) => {
        const targetName = field === "sourceLabel" ? "sourcePlatform" : field;
        const input = formElement.elements.namedItem(targetName);
        if (input && draft[field] != null) {
          input.value = draft[field];
        }
      });
      preview.innerHTML = `
        <div class="draft-preview">
          <div class="draft-preview-head">
            <div>
              <div class="eyebrow">Imported Draft</div>
              <h3>${escapeHtml(draft.title || "Imported job draft")}</h3>
              <p class="muted">${escapeHtml(draft.company || "Unknown company")} · ${escapeHtml(draft.location || "Location not specified")}</p>
            </div>
            <span class="status ${data.importer?.ok ? "ready_to_apply" : "evaluating"}">${escapeHtml(
              data.importPath === "jd_fetcher_service" ? "Playwright draft" : data.importer?.ok ? "Fallback draft imported" : "Fallback draft"
            )}</span>
          </div>
          <p class="muted">Import path: ${escapeHtml(data.importPath || "fallback_importer")} · Extractor: ${escapeHtml(
            data.extractor || draft.importMeta?.strategy || "manual_fallback"
          )} · Preview length: ${escapeHtml(
            draft.importMeta?.textLength || 0
          )} chars</p>
          ${data.warning ? `<p class="muted">Warning: ${escapeHtml(data.warning)}</p>` : ""}
          ${buildImportWarningsHtml(draft.importMeta?.warnings || [])}
          ${data.pipelinePreview?.length ? `<div style="margin-top:16px;">${renderPipelineStages(data.pipelinePreview)}</div>` : ""}
          <p class="muted">You can edit any field above before creating the job.</p>
        </div>
      `;
      feedback.innerHTML = renderNotice(
        data.importer?.ok ? "success" : "warning",
        data.importer?.ok
          ? data.importPath === "jd_fetcher_service"
            ? "Playwright URL import succeeded. Review the fields, then confirm creation."
            : "Fallback importer succeeded. Review the fields, then confirm creation."
          : data.importer?.errorSummary || "URL import fell back to a manual draft."
      );
    } catch (error) {
      feedback.innerHTML = renderNotice("error", error.message);
    } finally {
      setButtonPending(importButton, false);
    }
  });

  formElement.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.innerHTML = "";
    try {
      const formData = new FormData(event.target);
      const payload = Object.fromEntries(formData.entries());
      payload.source = payload.jobUrl ? "url" : "manual";
      const data = await api("/api/jobs/ingest", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      window.location.hash = `#/jobs/${data.job.id}`;
    } catch (error) {
      feedback.innerHTML = renderNotice("error", error.message);
    }
  });
}

function renderStatusButtons(job, allowedNextStatuses, recommendedNextStatuses) {
  if (!allowedNextStatuses?.length) {
    return `<div class="empty">当前状态没有可继续推进的流转。</div>`;
  }

  return `
    <div class="toolbar">
      ${allowedNextStatuses
        .map((status) => {
          const emphasized = recommendedNextStatuses.includes(status) ? "primary" : "";
          return `<button class="button ${emphasized}" data-next-status="${status}">${getStatusActionLabel(status)}</button>`;
        })
        .join("")}
    </div>
  `;
}

function prepSnapshot(prep) {
  if (!prep) {
    return `<div class="empty">尚未生成或保存准备材料。</div>`;
  }

  const completedCount = prep.checklist.filter((item) => item.completed).length;
  return `
    <p><strong>Keywords:</strong> ${escapeHtml(prep.resumeTailoring.targetKeywords.join(", "))}</p>
    ${prep.tailoredSummary ? `<p><strong>Tailored Summary:</strong> ${escapeHtml(prep.tailoredSummary)}</p>` : ""}
    ${prep.whyMe ? `<p><strong>Why Me:</strong> ${escapeHtml(prep.whyMe)}</p>` : ""}
    <p>${escapeHtml(prep.selfIntro.short)}</p>
    ${(prep.talkingPoints || []).length ? `<p><strong>Talking Points:</strong> ${escapeHtml(prep.talkingPoints.slice(0, 2).join(" / "))}</p>` : ""}
    <p class="muted">Checklist: ${completedCount}/${prep.checklist.length} completed</p>
    <a class="button" href="#/prep/${prep.jobId}">进入 Prep 编辑</a>
  `;
}

function recommendationTone(recommendation) {
  if (recommendation === "apply") return "success";
  if (recommendation === "cautious") return "warning";
  return "error";
}

function renderNextAction(nextAction) {
  if (!nextAction) {
    return `<div class="empty">No recommended next step right now. Review this job manually or reopen it later.</div>`;
  }

  return `
    <div class="next-action ${nextAction.tone || "neutral"}">
      <div class="next-action-copy">
        <div class="next-action-label">Next Action</div>
        <h3>${escapeHtml(nextAction.title)}</h3>
        <p>${escapeHtml(nextAction.description)}</p>
      </div>
      <div class="next-action-controls">
        ${
          nextAction.ctaType === "open_prep"
            ? `<a class="button primary" href="#/prep/${nextAction.jobId}">${escapeHtml(nextAction.ctaLabel)}</a>`
            : nextAction.ctaType === "prepare"
              ? `<button class="button primary" id="next-action-prepare">${escapeHtml(nextAction.ctaLabel)}</button>`
              : nextAction.ctaType === "evaluate"
                ? `<button class="button primary" id="next-action-evaluate">${escapeHtml(nextAction.ctaLabel)}</button>`
                : nextAction.ctaType === "status"
                  ? `<button class="button primary" id="next-action-status" data-next-status="${nextAction.nextStatus}">${escapeHtml(nextAction.ctaLabel)}</button>`
                  : `<span class="muted">${escapeHtml(nextAction.ctaLabel || "Review manually")}</span>`
        }
      </div>
    </div>
  `;
}

function renderTimeline(logs) {
  if (!logs.length) {
    return `<div class="empty">No activity recorded yet.</div>`;
  }

  return `
    <div class="timeline">
      ${logs
        .map(
          (log) => `
            <div class="timeline-item">
              <div class="timeline-dot"></div>
              <div class="timeline-content">
                <div class="timeline-meta">
                  <strong>${escapeHtml(log.eventLabel || humanizeAuditEvent(log.type || log.action))}</strong>
                  <span class="muted">${escapeHtml(log.timeText || new Date(log.timestamp || log.createdAt).toLocaleString())}</span>
                </div>
                <div>${escapeHtml(log.summary)}</div>
                ${log.agentName ? `<div class="muted">Agent: ${escapeHtml(log.actorLabel || log.agentName)}</div>` : ""}
                ${log.inputSummary ? `<div class="trace-detail"><strong>What the system saw</strong><span>${escapeHtml(log.inputSummary)}</span></div>` : ""}
                ${log.outputSummary ? `<div class="trace-detail"><strong>What it produced</strong><span>${escapeHtml(log.outputSummary)}</span></div>` : ""}
                ${log.decisionReason ? `<div class="trace-detail"><strong>Why it made this call</strong><span>${escapeHtml(log.decisionReason)}</span></div>` : ""}
                ${log.policyInfluenceSummary ? `<div class="trace-detail"><strong>Policy context</strong><span>${escapeHtml(log.policyInfluenceSummary)}</span></div>` : ""}
                ${log.activePolicyVersion ? `<div class="trace-detail"><strong>Active policy</strong><span>${escapeHtml(log.activePolicyVersion)}</span></div>` : ""}
                ${log.policyProposalId ? `<div class="trace-detail"><strong>Related proposal</strong><span>${escapeHtml(log.policyProposalId)}</span></div>` : ""}
                ${log.overrideApplied ? `<div class="trace-detail"><strong>User override</strong><span>${escapeHtml(log.overrideSummary || "user override applied")}</span></div>` : ""}
                ${
                  log.decisionBreakdown
                    ? `<div class="trace-detail"><strong>Decision breakdown</strong><span>base ${escapeHtml(log.decisionBreakdown.baseScore)} / history ${escapeHtml(log.decisionBreakdown.historyAdjustment)} / policy ${escapeHtml(log.decisionBreakdown.policyAdjustment)} / final ${escapeHtml(log.decisionBreakdown.finalScore)} -> ${escapeHtml(log.decisionBreakdown.finalDecision)}</span></div>`
                    : ""
                }
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPipelineStages(stages = []) {
  if (!stages.length) {
    return `<div class="empty">No explicit pipeline stages recorded yet.</div>`;
  }

  return `
    <div class="pipeline-stage-list">
      ${stages
        .map((stage) => {
          const tone =
            stage.status === "completed"
              ? "ready_to_apply"
              : stage.status === "fallback"
                ? "to_prepare"
                : stage.status === "active" || stage.status === "ready"
                  ? "evaluating"
                  : stage.status === "failed"
                    ? "archived"
                    : "";
          return `
            <div class="pipeline-stage-item">
              <div class="pipeline-stage-top">
                <strong>${escapeHtml(stage.label)}</strong>
                <span class="status ${tone}">${escapeHtml(stage.status)}</span>
              </div>
              <div class="muted">${escapeHtml(stage.summary || "No stage summary available.")}</div>
              ${stage.timestamp ? `<div class="muted">${escapeHtml(new Date(stage.timestamp).toLocaleString())}</div>` : ""}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

async function renderJobDetail(jobId, message = "", errorMessage = "") {
  setActiveNav("#/jobs");
  title.textContent = "Job Detail";
  subtitle.textContent = "围绕单个岗位展示评估、准备、状态推进和活动日志。";
  renderLoadingState("Loading job detail", "Pulling evaluation, prep and activity data for this role...");
  const data = await api(`/api/jobs/${jobId}`);
  const {
    job,
    fitAssessment,
    applicationPrep,
    tasks,
    activityLogs,
    interviewReflection,
    badCase,
    globalPolicy,
    policyExplanation,
    pipelineStages,
    policyProposals,
    policyAuditLogs,
    allowedNextStatuses,
    recommendedNextStatuses,
    nextAction
  } = data;
  const enhancedNextAction = nextAction ? { ...nextAction, jobId: job.id } : null;
  const jobVm = createJobViewModel({ job, fitAssessment, nextAction: enhancedNextAction });
  const policyVm = createPolicyViewModel(globalPolicy);
  const prepVm = createPrepViewModel({ prep: applicationPrep, fitAssessment });
  const proposalVms = (policyProposals || []).map((proposal) => createProposalViewModel(proposal));
  const timelineEntries = (activityLogs || []).map((log) => ({ ...createAuditEventViewModel(log), ...log }));
  const recommendationClass = fitAssessment ? recommendationTone(fitAssessment.recommendation) : "neutral";
  const completedCount = applicationPrep ? applicationPrep.checklist.filter((item) => item.completed).length : 0;
  const prepReady = applicationPrep && completedCount >= 3;
  const policyVersion = fitAssessment?.activePolicyVersion || policyVm.version;
  const policySummaryText =
    fitAssessment?.policyInfluenceSummary ||
    policyExplanation?.[0] ||
    "No explicit policy influence is recorded for this role yet.";
  const recommendationMeta = humanizeRecommendation(fitAssessment?.recommendation);
  const strategyMeta = humanizeStrategyDecision(fitAssessment?.strategyDecision || job.strategyDecision);

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="detail-shell">
      <section class="detail-hero ${recommendationClass}">
        <div class="hero-copy">
          <div class="eyebrow">Job Decision</div>
          <h3 class="hero-title">${escapeHtml(jobVm.company)} / ${escapeHtml(jobVm.title)}</h3>
          <p class="hero-subtitle">${escapeHtml(jobVm.location)} · ${escapeHtml(job.sourceLabel)} · updated ${escapeHtml(jobVm.updatedAtText)}</p>
          <div class="hero-meta">
            ${statusBadge(job.raw.status)}
            ${
              fitAssessment
                ? `${semanticBadge(`${recommendationMeta.label} · ${fitAssessment.fitScore}`, recommendationMeta.tone)}
                   <span class="status">${escapeHtml(jobVm.strategyLabel)}</span>`
                : `<span class="status">Evaluation pending</span>`
            }
            <span class="status">Priority · ${escapeHtml(jobVm.priorityLabel)}</span>
            <span class="status">Policy · ${escapeHtml(policyVersion)}</span>
          </div>
          <p>${escapeHtml(fitAssessment?.decisionSummary || job.strategyReasoning || "Run evaluation to generate a decision summary for this role.")}</p>
          ${
            job.policyOverride?.active
              ? `<div class="notice warning">Override active: ${escapeHtml(job.policyOverride.action)}${job.policyOverride.reason ? ` · ${escapeHtml(job.policyOverride.reason)}` : ""}</div>`
              : ""
          }
        </div>
        <div class="stack">
          <div class="metric-card">
            <div class="metric-label">Recommendation</div>
            <div class="metric">${escapeHtml(jobVm.recommendationLabel)}</div>
            <div class="metric-support">${escapeHtml(fitAssessment?.suggestedAction || "Run evaluation first.")}</div>
          </div>
          <div class="split-metrics">
            <div class="metric-card">
              <div class="metric-label">Fit Score</div>
              <div class="metric">${escapeHtml(fitAssessment?.fitScore ?? "-")}</div>
              <div class="metric-support">confidence ${Math.round((fitAssessment?.confidence || 0) * 100)}%</div>
            </div>
            <div class="metric-card">
            <div class="metric-label">Prep</div>
            <div class="metric">${escapeHtml(prepVm.checklistProgress)}</div>
            <div class="metric-support">${escapeHtml(prepVm.readinessLabel)}</div>
          </div>
          </div>
          <div class="card surface-dark">
            <div class="eyebrow">Policy Influence</div>
            <h4>${escapeHtml(jobVm.strategyLabel)}</h4>
            <p class="muted">${escapeHtml(policySummaryText)}</p>
          </div>
        </div>
      </section>

      <section>
        ${renderNextAction(enhancedNextAction)}
        <div class="toolbar" style="margin-top:12px;">
          <button class="button" id="evaluate-btn">重新评估</button>
          <button class="button" id="prepare-btn">生成初稿</button>
          <a class="button primary" href="#/prep/${job.id}">进入 Prep</a>
        </div>
      </section>

      <section class="detail-main">
        <div class="stack">
          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Pipeline</div>
                <h3>Agent pipeline</h3>
              </div>
            </div>
            ${renderPipelineStages(pipelineStages || [])}
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Summary</div>
                <h3>Job structured summary</h3>
              </div>
            </div>
            <p>${escapeHtml(job.jdStructured.summary)}</p>
            <div class="info-grid">
              <div class="panel">
                <strong>Responsibilities</strong>
                <ul class="list list-tight">${job.jdStructured.responsibilities.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>
              <div class="panel">
                <strong>Requirements</strong>
                <ul class="list list-tight">${job.jdStructured.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>
              <div class="panel">
                <strong>Preferred Qualifications</strong>
                <ul class="list list-tight">${(job.jdStructured.preferredQualifications || [])
                  .map((item) => `<li>${escapeHtml(item)}</li>`)
                  .join("") || "<li>No explicit preferred qualifications detected.</li>"}</ul>
              </div>
              <div class="panel">
                <strong>Risk Flags</strong>
                <ul class="list list-tight">${job.jdStructured.riskFlags.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Fit Assessment</div>
                <h3>Recommendation and reasoning</h3>
              </div>
            </div>
            ${fitAssessment
              ? `
                  <div class="panel">
                    <strong>${escapeHtml(jobVm.recommendationLabel)}</strong>
                    <div class="muted">${escapeHtml(jobVm.strategyLabel)} · ${escapeHtml(fitAssessment.suggestedAction)}</div>
                    <div class="muted">${escapeHtml(fitAssessment.strategyReasoning || job.strategyReasoning || "")}</div>
                  </div>
                  <div class="info-grid">
                    <div class="panel">
                      <strong>Decision Breakdown</strong>
                      <div class="muted">base ${escapeHtml(fitAssessment.decisionBreakdown?.baseScore ?? "-")}</div>
                      <div class="muted">history ${escapeHtml(fitAssessment.decisionBreakdown?.historyAdjustment ?? "-")}</div>
                      <div class="muted">policy ${escapeHtml(fitAssessment.decisionBreakdown?.policyAdjustment ?? "-")}</div>
                      <div class="muted">final ${escapeHtml(fitAssessment.decisionBreakdown?.finalScore ?? fitAssessment.fitScore)} -> ${escapeHtml(fitAssessment.decisionBreakdown?.finalDecision || fitAssessment.strategyDecision || "pending")}</div>
                      ${fitAssessment.policyProposalId ? `<div class="muted">proposal ${escapeHtml(fitAssessment.policyProposalId)}</div>` : ""}
                      ${fitAssessment.overrideApplied ? `<div class="muted">override ${escapeHtml(fitAssessment.overrideSummary || "user override applied")}</div>` : ""}
                    </div>
                    <div class="panel">
                      <strong>Why Apply</strong>
                      <ul class="list list-tight">${fitAssessment.whyApply.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                    </div>
                    <div class="panel">
                      <strong>Key Gaps</strong>
                      <ul class="list list-tight">${fitAssessment.keyGaps.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                    </div>
                    <div class="panel">
                      <strong>Risk Flags</strong>
                      <ul class="list list-tight">${fitAssessment.riskFlags.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                    </div>
                  </div>
                `
              : `<div class="empty">尚未生成评估结果。</div>`}
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Policy</div>
                <h3>Explainability</h3>
              </div>
            </div>
            <div class="panel">
              <strong>Global policy context</strong>
              <div class="muted">focus ${escapeHtml(policyVm.focusModeLabel)} · risk tolerance ${escapeHtml(policyVm.riskToleranceLabel)}</div>
              <div class="muted">${escapeHtml(policyVm.shortSummaryText)}</div>
            </div>
            <div class="info-grid">
              <div class="panel">
                <strong>Policy influence</strong>
                <div class="muted">${escapeHtml(fitAssessment?.policyInfluenceSummary || "No explicit policy influence available yet.")}</div>
              </div>
              <div class="panel">
                <strong>History influence</strong>
                <div class="muted">${escapeHtml(fitAssessment?.historyInfluenceSummary || "No historical adjustment recorded yet.")}</div>
              </div>
            </div>
            <ul class="list list-tight">
              ${(policyExplanation || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No explicit policy explanation available yet.</li>"}
            </ul>
          </div>

          ${interviewReflection
            ? `
              <div class="card">
                <div class="section-head">
                  <div>
                    <div class="eyebrow">Reflection</div>
                    <h3>Interview feedback</h3>
                  </div>
                </div>
                <p>${escapeHtml(interviewReflection.summary)}</p>
                <ul class="list list-tight">${interviewReflection.improvementActions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>
            `
            : ""}
        </div>

        <div class="stack">
          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Prep</div>
                <h3>Preparation summary</h3>
              </div>
            </div>
            ${prepSnapshot(applicationPrep)}
            ${applicationPrep ? `<p class="muted">Core checklist complete: ${escapeHtml(prepVm.checklistProgress)}</p>` : ""}
            ${
              job.strategyDecision === "cautious_proceed"
                ? `<div class="notice warning">这是一条 cautious_proceed 岗位。Prep 时请优先处理这些风险：${escapeHtml((fitAssessment?.riskFlags || []).slice(0, 2).join(" / ") || "review fit risks")}</div>`
                : ""
            }
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Status</div>
                <h3>Primary action strip</h3>
              </div>
            </div>
            <p class="muted">当前状态只展示合法流转，推荐动作会高亮。</p>
            ${renderStatusButtons(job, allowedNextStatuses, recommendedNextStatuses)}
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Overrides</div>
                <h3>Human control</h3>
              </div>
            </div>
            <label>Override Reason
              <input id="job-override-reason" value="${escapeHtml(job.policyOverride?.reason || "")}" placeholder="Optional note for the override" />
            </label>
            <div class="toolbar">
              <button class="button" data-job-override="force_proceed">Force Proceed</button>
              <button class="button" data-job-override="ignore_policy">Ignore Policy</button>
              <button class="button" data-job-override="force_archive">Force Archive</button>
            </div>
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Bad Case</div>
                <h3>Failure memory</h3>
              </div>
            </div>
            <p class="muted">
              ${badCase ? "This job is currently stored as a bad case for later review." : "Mark misleading or low-value decisions so the system can keep a failure memory."}
            </p>
            <label>Issue Note
              <textarea id="badcase-note" placeholder="Why was this a bad case?">${escapeHtml(badCase?.issueDescription || "")}</textarea>
            </label>
            <div class="toolbar">
              <button class="button ${badCase ? "" : "primary"}" id="toggle-badcase">
                ${badCase ? "取消 Bad Case" : "标记为 Bad Case"}
              </button>
            </div>
            ${
              badCase
                ? `
                  <div class="info-grid">
                    <div class="panel">
                      <strong>Final Status</strong>
                      <div class="muted">${escapeHtml(badCase.finalStatus)}</div>
                    </div>
                    <div class="panel">
                      <strong>Stored Snapshot</strong>
                      <div class="muted">${escapeHtml(badCase.company)} / ${escapeHtml(badCase.title)}</div>
                    </div>
                  </div>
                `
                : ""
            }
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Policy Governance</div>
                <h3>Snapshot</h3>
              </div>
            </div>
            ${
              proposalVms.length
                ? `<div class="stack">${proposalVms
                    .slice(0, 3)
                    .map(
                      (proposalVm) => `
                        <div class="panel">
                          <strong>${escapeHtml(proposalVm.triggerLabel)}</strong>
                          <div class="muted">status: ${escapeHtml(proposalVm.statusLabel)}</div>
                          <div class="muted">${escapeHtml(proposalVm.diffSummaryText || proposalVm.reasonText)}</div>
                        </div>
                      `
                    )
                    .join("")}</div>`
                : `<div class="empty">No recent policy proposals.</div>`
            }
            ${
              (policyAuditLogs || []).length
                ? `<div class="stack" style="margin-top:12px;">${policyAuditLogs
                    .slice(0, 3)
                    .map(
                      (log) => `
                        <div class="panel">
                          <strong>${escapeHtml(log.eventType)}</strong>
                          <div class="muted">${escapeHtml(log.summary)}</div>
                        </div>
                      `
                    )
                    .join("")}</div>`
                : ""
            }
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">Tasks</div>
                <h3>Execution notes</h3>
              </div>
            </div>
            ${tasks.length
              ? `<div class="stack">${tasks
                  .map(
                    (task) => `
                      <div class="panel">
                        <strong>${escapeHtml(task.title)}</strong>
                        <div class="muted">${escapeHtml(task.note || "")}</div>
                      </div>
                    `
                  )
                  .join("")}</div>`
              : `<div class="empty">暂无任务。</div>`}
          </div>
        </div>
      </section>

      <section class="detail-bottom">
        <div class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">Timeline</div>
              <h3>Activity and decision trace</h3>
            </div>
          </div>
          ${renderTimeline(timelineEntries)}
        </div>
      </section>
    </div>
  `;

  document.getElementById("evaluate-btn").addEventListener("click", async () => {
    const button = document.getElementById("evaluate-btn");
    try {
      setButtonPending(button, true, "Re-evaluating...");
      await api(`/api/jobs/${job.id}/evaluate`, { method: "POST" });
      renderJobDetail(job.id, "评估已更新。");
    } catch (error) {
      setButtonPending(button, false);
      renderJobDetail(job.id, "", error.message);
    }
  });

  document.getElementById("prepare-btn").addEventListener("click", async () => {
    const button = document.getElementById("prepare-btn");
    try {
      setButtonPending(button, true, "Generating...");
      await api(`/api/jobs/${job.id}/prepare`, { method: "POST" });
      renderJobDetail(job.id, "准备材料初稿已生成。");
    } catch (error) {
      setButtonPending(button, false);
      renderJobDetail(job.id, "", error.message);
    }
  });

  const nextActionEvaluate = document.getElementById("next-action-evaluate");
  if (nextActionEvaluate) {
    nextActionEvaluate.addEventListener("click", async () => {
      try {
        setButtonPending(nextActionEvaluate, true, "Re-evaluating...");
        await api(`/api/jobs/${job.id}/evaluate`, { method: "POST" });
        renderJobDetail(job.id, "评估已更新。");
      } catch (error) {
        setButtonPending(nextActionEvaluate, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  const nextActionPrepare = document.getElementById("next-action-prepare");
  if (nextActionPrepare) {
    nextActionPrepare.addEventListener("click", async () => {
      try {
        setButtonPending(nextActionPrepare, true, "Generating...");
        await api(`/api/jobs/${job.id}/prepare`, { method: "POST" });
        renderJobDetail(job.id, "准备材料初稿已生成。");
      } catch (error) {
        setButtonPending(nextActionPrepare, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  const nextActionStatus = document.getElementById("next-action-status");
  if (nextActionStatus) {
    nextActionStatus.addEventListener("click", async () => {
      const nextStatus = nextActionStatus.getAttribute("data-next-status");
      try {
        setButtonPending(nextActionStatus, true, "Updating...");
        await api(`/api/jobs/${job.id}/status`, {
          method: "POST",
          body: JSON.stringify({ nextStatus })
        });
        renderJobDetail(job.id, `状态已更新为 ${nextStatus}。`);
      } catch (error) {
        setButtonPending(nextActionStatus, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  document.querySelectorAll("[data-next-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextStatus = button.getAttribute("data-next-status");
      const needsConfirm = nextStatus === "archived" || nextStatus === "rejected";
      if (needsConfirm && !window.confirm(`Confirm status change to ${nextStatus}?`)) {
        return;
      }
      try {
        setButtonPending(button, true, "Updating...");
        await api(`/api/jobs/${job.id}/status`, {
          method: "POST",
          body: JSON.stringify({ nextStatus })
        });
        renderJobDetail(job.id, `状态已更新为 ${nextStatus}。`);
      } catch (error) {
        setButtonPending(button, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  });

  const badCaseButton = document.getElementById("toggle-badcase");
  if (badCaseButton) {
    badCaseButton.addEventListener("click", async () => {
      const issueDescription = document.getElementById("badcase-note")?.value || "";
      try {
        setButtonPending(badCaseButton, true, badCase ? "Removing..." : "Saving...");
        await api(`/api/jobs/${job.id}/badcase`, {
          method: "POST",
          body: JSON.stringify({
            isBadCase: !badCase,
            issueDescription
          })
        });
        renderJobDetail(job.id, badCase ? "Bad case 已取消。" : "岗位已记录为 bad case。");
      } catch (error) {
        setButtonPending(badCaseButton, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  document.querySelectorAll("[data-job-override]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-job-override");
      const actionLabel = humanizeOverride(action);
      if ((action === "force_archive" || action === "ignore_policy") && !window.confirm(`Confirm: ${actionLabel}?`)) {
        return;
      }
      const reason = document.getElementById("job-override-reason")?.value || "";
      try {
        setButtonPending(button, true, "Applying...");
        await api(`/api/jobs/${job.id}/override`, {
          method: "POST",
          body: JSON.stringify({ action, reason })
        });
        renderJobDetail(job.id, `${actionLabel} 已生效。`);
      } catch (error) {
        setButtonPending(button, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  });
}

async function renderPrep(jobId, message = "", errorMessage = "") {
  setActiveNav("#/prep");
  title.textContent = "Prep";
  subtitle.textContent = "编辑申请材料并保存，再回到 Job Detail 推进状态。";

  if (!jobId) {
    app.innerHTML = `<div class="empty">请从某个 Job Detail 进入 Prep 页面。</div>`;
    return;
  }

  renderLoadingState("Loading prep workspace", "Syncing the latest prep draft and readiness state...");
  const data = await api(`/api/jobs/${jobId}`);
  const { job, applicationPrep } = data;
  const draft = buildPrepDraft(applicationPrep);
  const prepVm = createPrepViewModel({ prep: applicationPrep, fitAssessment: data.fitAssessment });
  const jobVm = createJobViewModel({ job, fitAssessment: data.fitAssessment });
  const prepRiskNote =
    job.strategyDecision === "cautious_proceed"
      ? `这条岗位带有谨慎推进标记，建议优先处理 ${(data.fitAssessment?.riskFlags || []).slice(0, 2).join(" / ") || "关键风险项"}.`
      : "";

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="prep-shell">
      <section class="prep-hero">
        <div class="hero-copy">
          <div class="eyebrow">Prep Workspace</div>
          <h3 class="hero-title">${escapeHtml(jobVm.company)} / ${escapeHtml(jobVm.title)}</h3>
          <p class="hero-subtitle">${escapeHtml(jobVm.location)} · 当前状态 ${escapeHtml(jobVm.displayStatus)}</p>
          <div class="hero-meta">
            ${statusBadge(job.raw.status)}
            <span class="status">${escapeHtml(jobVm.strategyLabel)}</span>
            <span class="status">${escapeHtml(prepVm.readinessLabel)}</span>
          </div>
          ${
            prepRiskNote
              ? `<div class="notice warning">${escapeHtml(prepRiskNote)}</div>`
              : `<div class="muted">把这条岗位的申请材料整理成可直接提交的状态，再回到 Job Detail 推进流程。</div>`
          }
        </div>
        <div class="split-metrics">
          <div class="metric-card">
            <div class="metric-label">Checklist</div>
            <div class="metric">${escapeHtml(prepVm.checklistProgress)}</div>
            <div class="metric-support">${escapeHtml(prepVm.readinessLabel)}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Keywords</div>
            <div class="metric">${escapeHtml(String(draft.targetKeywords.length))}</div>
            <div class="metric-support">tailoring anchors</div>
          </div>
        </div>
      </section>

      <form id="prep-form" class="stack">
        <section class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">Resume Tailoring</div>
              <h3>Resume tailoring</h3>
            </div>
          </div>
          <div class="stack">
            <label>Target Keywords
              <input name="targetKeywords" value="${escapeHtml(draft.targetKeywords.join(", "))}" />
            </label>
            <label>Tailored Resume Bullets
              <textarea name="tailoredResumeBullets">${escapeHtml(draft.tailoredResumeBullets)}</textarea>
            </label>
          </div>
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">Narrative Pack</div>
              <h3>Summary, why me, self intro, Q&A</h3>
            </div>
          </div>
          <div class="stack">
            <label>Tailored Summary
              <textarea name="tailoredSummary">${escapeHtml(draft.tailoredSummary)}</textarea>
            </label>
            <label>Why Me
              <textarea name="whyMe">${escapeHtml(draft.whyMe)}</textarea>
            </label>
            <div class="split">
              <label>Self Intro (Short)
                <textarea name="selfIntroShort">${escapeHtml(draft.selfIntroShort)}</textarea>
              </label>
              <label>Self Intro (Medium)
                <textarea name="selfIntroMedium">${escapeHtml(draft.selfIntroMedium)}</textarea>
              </label>
            </div>
            <label>Q&A Draft
              <textarea name="qaDraft">${escapeHtml(draft.qaDraft)}</textarea>
            </label>
            <label>Talking Points
              <textarea name="talkingPoints">${escapeHtml(draft.talkingPoints)}</textarea>
            </label>
            <label>Cover / Apply Note
              <textarea name="coverNote">${escapeHtml(draft.coverNote)}</textarea>
            </label>
            <label>Outreach Note
              <textarea name="outreachNote">${escapeHtml(draft.outreachNote)}</textarea>
            </label>
          </div>
        </section>

        <section class="card prep-checklist-card">
          <div class="section-head">
            <div>
              <div class="eyebrow">Readiness</div>
              <h3>Checklist and submit readiness</h3>
            </div>
            <div class="muted">${prepVm.completionStatus === "complete" ? "Ready to move forward" : "Need core items before ready_to_apply"}</div>
          </div>
          ${
            prepVm.completionStatus === "complete"
              ? `<div class="notice success">核心 checklist 已达到准备完成标准，现在可以标记 ready_to_apply。</div>`
              : `<div class="notice warning">${escapeHtml(prepVm.warningText)}</div>`
          }
          <div class="stack">
            ${draft.checklist
              .map(
                (item, index) => `
                  <label class="checkbox-row prep-checklist-row ${item.completed ? "completed" : ""}">
                    <input type="checkbox" name="checklist_completed_${index}" ${item.completed ? "checked" : ""} />
                    <input type="hidden" name="checklist_key_${index}" value="${escapeHtml(item.key)}" />
                    <input type="text" name="checklist_label_${index}" value="${escapeHtml(item.label)}" />
                  </label>
                `
              )
              .join("")}
          </div>
        </section>

        <section class="prep-actions">
          <div class="toolbar">
            <button class="button primary" type="submit">保存 Prep</button>
            <button class="button" type="button" id="mark-prep-ready">标记准备完成</button>
            <a class="text-link" href="#/jobs/${job.id}">返回 Job Detail</a>
          </div>
        </section>
      </form>
    </div>
  `;

  document.getElementById("prep-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = event.target.querySelector('button[type="submit"]');
    try {
      setButtonPending(submitButton, true, "Saving...");
      const formData = new FormData(event.target);
      const checklist = draft.checklist.map((_, index) => ({
        key: String(formData.get(`checklist_key_${index}`) || ""),
        label: String(formData.get(`checklist_label_${index}`) || ""),
        completed: Boolean(formData.get(`checklist_completed_${index}`))
      }));
      const payload = {
        targetKeywords: String(formData.get("targetKeywords") || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        tailoredResumeBullets: formData.get("tailoredResumeBullets"),
        tailoredSummary: formData.get("tailoredSummary"),
        whyMe: formData.get("whyMe"),
        selfIntroShort: formData.get("selfIntroShort"),
        selfIntroMedium: formData.get("selfIntroMedium"),
        qaDraft: formData.get("qaDraft"),
        talkingPoints: formData.get("talkingPoints"),
        coverNote: formData.get("coverNote"),
        outreachNote: formData.get("outreachNote"),
        checklist
      };
      await api(`/api/jobs/${job.id}/prep/save`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      renderPrep(job.id, "Prep 已保存。");
    } catch (error) {
      setButtonPending(submitButton, false);
      renderPrep(job.id, "", error.message);
    }
  });

  document.getElementById("mark-prep-ready").addEventListener("click", async () => {
    const button = document.getElementById("mark-prep-ready");
    try {
      setButtonPending(button, true, "Checking...");
      const formData = new FormData(document.getElementById("prep-form"));
      const checklist = draft.checklist.map((_, index) => ({
        key: String(formData.get(`checklist_key_${index}`) || ""),
        label: String(formData.get(`checklist_label_${index}`) || ""),
        completed: Boolean(formData.get(`checklist_completed_${index}`))
      }));

      const payload = {
        targetKeywords: String(formData.get("targetKeywords") || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        tailoredResumeBullets: formData.get("tailoredResumeBullets"),
        tailoredSummary: formData.get("tailoredSummary"),
        whyMe: formData.get("whyMe"),
        selfIntroShort: formData.get("selfIntroShort"),
        selfIntroMedium: formData.get("selfIntroMedium"),
        qaDraft: formData.get("qaDraft"),
        talkingPoints: formData.get("talkingPoints"),
        coverNote: formData.get("coverNote"),
        outreachNote: formData.get("outreachNote"),
        checklist
      };

      const saved = await api(`/api/jobs/${job.id}/prep/save`, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (!saved.prepReady) {
        setButtonPending(button, false);
        renderPrep(job.id, "", "请先完成简历、自我介绍和 Q&A 三项核心 checklist。");
        return;
      }

      await api(`/api/jobs/${job.id}/status`, {
        method: "POST",
        body: JSON.stringify({ nextStatus: "ready_to_apply" })
      });
      renderJobDetail(job.id, "Prep 已完成，岗位已进入 ready_to_apply。");
    } catch (error) {
      setButtonPending(button, false);
      renderPrep(job.id, "", error.message);
    }
  });
}

async function renderInterviews() {
  setActiveNav("#/interviews");
  title.textContent = "Interviews";
  subtitle.textContent = "记录面试问题、复盘改进点，并把洞察回流到求职策略。";
  const jobs = await api("/api/jobs");

  app.innerHTML = `
    <div class="panel">
      <form id="reflection-form" class="stack">
        <div class="split">
          <label>Job
            <select name="jobId">
              ${jobs.jobs.map((job) => `<option value="${job.id}">${escapeHtml(job.company)} / ${escapeHtml(job.title)}</option>`).join("")}
            </select>
          </label>
          <label>Round Name<input name="roundName" value="Hiring Manager Screen" /></label>
        </div>
        <div class="split">
          <label>Interviewer Type<input name="interviewerType" value="Hiring Manager" /></label>
          <label>Interview Date<input name="interviewDate" value="${new Date().toISOString()}" /></label>
        </div>
        <label>Questions Asked<textarea name="questionsAsked">How do you work with engineering?
What motivates you about this role?</textarea></label>
        <label>Notes<textarea name="notes">Need tighter technical collaboration examples.</textarea></label>
        <button class="button primary" type="submit">生成复盘</button>
      </form>
    </div>
    <div id="reflection-result" style="margin-top:16px;"></div>
  `;

  document.getElementById("reflection-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.target).entries());
    payload.questionsAsked = String(payload.questionsAsked)
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    const data = await api("/api/interviews/reflect", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    document.getElementById("reflection-result").innerHTML = sectionCard(
      "Reflection Output",
      `<p>${escapeHtml(data.reflection.summary)}</p>
       <h4>Improvement Actions</h4>
       <ul class="list">${data.reflection.improvementActions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    );
  });
}

async function renderProfile(message = "", errorMessage = "") {
  setActiveNav("#/profile");
  title.textContent = "Profile";
  subtitle.textContent = "编辑并保存求职画像，供评估和 Prep 真实读取。";
  const data = await api("/api/profile");
  const profile = data.profile || {};

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="panel">
      <form id="profile-form" class="stack">
        <div class="split">
          <label>Name<input name="name" value="${escapeHtml(profile.name || profile.fullName || "")}" required /></label>
          <label>Background<input name="background" value="${escapeHtml(profile.background || profile.headline || "")}" required /></label>
        </div>
        <div class="split">
          <label>Years of Experience<input name="yearsOfExperience" type="number" min="0" value="${escapeHtml(profile.yearsOfExperience || 0)}" /></label>
          <label>Target Roles<input name="targetRoles" value="${escapeHtml((profile.targetRoles || []).join(", "))}" /></label>
        </div>
        <div class="split">
          <label>Target Industries<input name="targetIndustries" value="${escapeHtml((profile.targetIndustries || []).join(", "))}" /></label>
          <label>Target Locations<input name="targetLocations" value="${escapeHtml((profile.targetLocations || profile.preferredLocations || []).join(", "))}" /></label>
        </div>
        <label>Strengths<textarea name="strengths">${escapeHtml((profile.strengths || []).join(", "))}</textarea></label>
        <label>Constraints<textarea name="constraints">${escapeHtml((profile.constraints || []).join(", "))}</textarea></label>
        <div class="panel">
          <h4>Policy Controls</h4>
          <label>Risk Tolerance Override
            <select name="riskToleranceOverride">
              <option value="" ${!(profile.policyPreferences?.riskToleranceOverride) ? "selected" : ""}>Auto</option>
              <option value="low" ${profile.policyPreferences?.riskToleranceOverride === "low" ? "selected" : ""}>low</option>
              <option value="medium" ${profile.policyPreferences?.riskToleranceOverride === "medium" ? "selected" : ""}>medium</option>
              <option value="high" ${profile.policyPreferences?.riskToleranceOverride === "high" ? "selected" : ""}>high</option>
            </select>
          </label>
          <label>我仍然想投这类岗位
            <input name="manualPreferredRoles" value="${escapeHtml((profile.policyPreferences?.manualPreferredRoles || []).join(", "))}" placeholder="例如 Product Strategy, Growth" />
          </label>
          <label>忽略系统对这些 risky roles 的建议
            <input name="ignoredRiskyRoles" value="${escapeHtml((profile.policyPreferences?.ignoredRiskyRoles || []).join(", "))}" placeholder="例如 Operations" />
          </label>
        </div>
        <label>Master Resume<textarea name="masterResume" required>${escapeHtml(profile.masterResume || profile.baseResume || "")}</textarea></label>
        <div class="toolbar">
          <button class="button primary" type="submit">保存 Profile</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = Object.fromEntries(new FormData(event.target).entries());
      await api("/api/profile/save", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      renderProfile("Profile 已保存。");
    } catch (error) {
      renderProfile("", error.message);
    }
  });
}

async function route() {
  const hash = window.location.hash || "#/dashboard";
  const parts = hash.slice(2).split("/");

  try {
    const session = await fetchAuthSession();
    if (!session.authenticated) {
      const demoSession = await ensureDemoSession();
      if (!demoSession.authenticated) {
        await renderUnauthenticatedWorkspace("Unable to create a demo session.");
        return;
      }
    }
    if (parts[0] === "dashboard" || parts[0] === "") {
      await renderDashboard();
      return;
    }
    if (parts[0] === "jobs" && parts[1] === "new") {
      await renderNewJob();
      return;
    }
    if (parts[0] === "jobs" && parts[1]) {
      await renderJobDetail(parts[1]);
      return;
    }
    if (parts[0] === "jobs") {
      await renderJobs();
      return;
    }
    if (parts[0] === "governance") {
      await renderGovernance();
      return;
    }
    if (parts[0] === "prep") {
      await renderPrep(parts[1]);
      return;
    }
    if (parts[0] === "interviews") {
      await renderInterviews();
      return;
    }
    if (parts[0] === "profile") {
      await renderProfile();
      return;
    }
    await renderDashboard();
  } catch (error) {
    if (error.code === "UNAUTHENTICATED" || /Authentication required/i.test(error.message)) {
      authSession = { authenticated: false, user: null };
      updateAuthChrome();
      await renderUnauthenticatedWorkspace("Your session expired. Please sign in again.");
      return;
    }
    app.innerHTML = `<div class="panel"><h3>Something went wrong</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

logoutButton?.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (error) {
    // Best effort logout: always clear local auth chrome and return to login screen.
  }
  authSession = { authenticated: false, user: null };
  updateAuthChrome();
  window.location.hash = "#/dashboard";
  await renderUnauthenticatedWorkspace("You have signed out.");
});

window.addEventListener("hashchange", route);
route();

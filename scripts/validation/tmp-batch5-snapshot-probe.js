
const fs = require("node:fs");
const orchestrator = require("../..//src/lib/orchestrator/workflow-controller");
(async () => {
  const seed = JSON.parse(fs.readFileSync("docs/eval/jobs-preference-eval.seed.json", "utf8"));
  const id = process.argv[2] || "acceptance_true_single_data_analyst";
  const c = (seed.cases || []).find((x) => x.id === id);
  const pref = c.userPreference.jobPreferenceProfile;
  await orchestrator.saveProfile({
    lightweightProfile: {
      targetRoles: pref.targetRoles || [],
      skills: pref.skills || [],
      preferredLocations: pref.preferredLocations || [],
      degree: "",
      acceptsNonTech: false
    },
    jobPreferenceProfile: pref
  });
  const res = await orchestrator.getJobWorkspaceList();
  const top10 = (res.jobWorkspaceViewModels || []).slice(0, 10).map((j) => ({
    id: j.id,
    op: j.scoringView?.opportunityType,
    ev: j.scoringView?.roleFitEvidenceType,
    score: j.scoringView?.userPriorityScore
  }));
  process.stdout.write(JSON.stringify(top10));
})().catch((e) => { console.error(e); process.exit(1); });

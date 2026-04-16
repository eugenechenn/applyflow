const { createId, nowIso } = require("../../utils/id");
const { generatePrepDraft, getLlmConfig } = require("../../llm/applyflow-llm-service");

function runRuleBasedApplicationPrepAgent({ job, profile }) {
  const firstProject = profile.keyProjects?.[0];
  const secondProject = profile.keyProjects?.[1];
  const thirdProject = profile.keyProjects?.[2];

  return {
    id: createId("prep"),
    jobId: job.id,
    profileId: profile.id,
    version: 1,
    resumeTailoring: {
      targetKeywords: job.jdStructured?.keywords?.slice(0, 5) || [],
      rewriteBullets: [
        {
          source: firstProject?.bullets?.[0] || "Add a relevant experience bullet.",
          rewritten: `Position this experience as evidence for ${job.title} through structured problem solving and cross-functional delivery.`
        },
        {
          source: secondProject?.bullets?.[0] || "Add another relevant experience bullet.",
          rewritten: `Emphasize measurable outcomes, prioritization judgment, and why this maps well to ${job.company}.`
        }
      ]
    },
    selfIntro: {
      short: `I bring a mix of strategy, operations, and product execution, and I'm especially motivated by roles like ${job.title} that require turning ambiguity into concrete decisions.`,
      medium: `My background combines business strategy and execution with growing hands-on work in AI-enabled workflows. What stands out about ${job.company} is the opportunity to apply structured product thinking to real execution problems.`
    },
    tailoredSummary: `Strong fit for ${job.title} because the role combines ambiguous problem framing, cross-functional execution, and narrative clarity around outcomes.`,
    whyMe: `I can connect strategy thinking with hands-on execution, which is especially relevant for ${job.company}'s need to turn role expectations into shipped outcomes.`,
    qaDraft: [
      {
        question: "Why this role?",
        draftAnswer: `It sits at the intersection of my core strengths and the direction I want to build in next: ${job.title}.`
      },
      {
        question: "Why are you a fit?",
        draftAnswer:
          "I am strongest when I need to frame ambiguous problems, align stakeholders, and convert insights into execution plans."
      }
    ],
    talkingPoints: [
      `Anchor the story around why ${job.company} needs structured decision-making in this role.`,
      `Use ${firstProject?.name || "a recent project"} to show problem framing and measurable execution.`,
      `Show comfort working cross-functionally with product, engineering, and GTM partners.`,
      `Be explicit about why this role is a focused next step, not a generic application.`
    ],
    coverNote: `Interested in ${job.company} because the role combines execution, strategy, and a clear opportunity to contribute with high ownership.`,
    outreachNote: `Hi ${job.company} team — I’m interested in the ${job.title} role because it sits right at the intersection of strategy, execution, and AI workflow design. I’d love to share why my background maps well to the role.`,
    checklist: [
      { key: "resume_reviewed", label: "Resume bullets reviewed", completed: true },
      { key: "intro_ready", label: "Self intro prepared", completed: true },
      { key: "qa_ready", label: "Q&A draft prepared", completed: true },
      { key: "talking_points_ready", label: "Talking points reviewed", completed: false },
      { key: "submit_ready", label: "Submission path confirmed", completed: false }
    ],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

async function runApplicationPrepAgent({ job, profile }) {
  const fallbackResult = runRuleBasedApplicationPrepAgent({ job, profile });
  const llmResult = await generatePrepDraft({ job, profile, fallbackResult });
  const llmProvider = getLlmConfig().provider;

  if (!llmResult.ok) {
    return {
      ...fallbackResult,
      llmMeta: {
        provider: "heuristic_fallback",
        model: llmResult.model,
        fallbackUsed: true,
        errorSummary: llmResult.errorSummary || null,
        latencyMs: llmResult.latencyMs || null
      }
    };
  }

  return {
    ...fallbackResult,
    resumeTailoring: {
      ...fallbackResult.resumeTailoring,
      targetKeywords:
        llmResult.data.targetKeywords.length > 0
          ? llmResult.data.targetKeywords
          : fallbackResult.resumeTailoring.targetKeywords,
      rewriteBullets:
        llmResult.data.rewriteBullets.length > 0
          ? llmResult.data.rewriteBullets
          : fallbackResult.resumeTailoring.rewriteBullets
    },
    selfIntro: {
      short: llmResult.data.selfIntroShort || fallbackResult.selfIntro.short,
      medium: llmResult.data.selfIntroMedium || fallbackResult.selfIntro.medium
    },
    tailoredSummary: llmResult.data.tailoredSummary || fallbackResult.tailoredSummary,
    whyMe: llmResult.data.whyMe || fallbackResult.whyMe,
    qaDraft: llmResult.data.qaDraft.length > 0 ? llmResult.data.qaDraft : fallbackResult.qaDraft,
    talkingPoints:
      llmResult.data.talkingPoints.length > 0 ? llmResult.data.talkingPoints : fallbackResult.talkingPoints,
    coverNote: llmResult.data.coverNote || fallbackResult.coverNote,
    outreachNote: llmResult.data.outreachNote || fallbackResult.outreachNote,
    llmMeta: {
      provider: llmProvider,
      model: llmResult.model,
      fallbackUsed: false,
      latencyMs: llmResult.latencyMs || null,
      errorSummary: null
    }
  };
}

module.exports = { runApplicationPrepAgent, runRuleBasedApplicationPrepAgent };

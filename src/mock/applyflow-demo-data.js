const { demoCuratedJobs } = require("./demo-curated-jobs");

const demoData = {
  profile: {
    id: "profile_001",
    fullName: "Alex Chen",
    headline: "MBA candidate pivoting into AI-native product roles",
    yearsOfExperience: 6,
    education: "MBA, Fudan University; B.A. in Economics",
    location: "Shanghai",
    targetRoles: ["AI Product Manager", "Product Strategy", "Business Operations"],
    targetIndustries: ["AI SaaS", "Enterprise Software", "Consumer Internet"],
    preferredLocations: ["Shanghai", "Beijing", "Shenzhen", "Remote"],
    workModes: ["hybrid", "remote"],
    salaryExpectation: "RMB 35k-50k / month",
    summary:
      "Cross-functional operator with strategy, growth, and product execution experience. Strong at structuring ambiguous problems, aligning stakeholders, and turning analysis into execution.",
    strengths: [
      "Structured problem solving",
      "0-to-1 product planning",
      "Cross-functional execution",
      "Stakeholder communication"
    ],
    coreSkills: ["Product strategy", "Growth analysis", "User research", "SQL", "AI workflow design"],
    keyProjects: [
      {
        id: "proj_001",
        name: "AI Sales Enablement Pilot",
        role: "Product + Operations Lead",
        bullets: [
          "Defined pilot workflow for sales call prep and objection handling",
          "Coordinated product, operations, and enablement teams to ship within 6 weeks"
        ],
        metrics: ["Reduced prep time by 40%", "Improved pilot adoption to 68% of target reps"]
      },
      {
        id: "proj_002",
        name: "Marketplace Conversion Diagnostic",
        role: "Strategy Manager",
        bullets: [
          "Built funnel diagnosis model to identify conversion leakage",
          "Presented quarterly growth priorities to BU leadership"
        ],
        metrics: ["Lifted checkout conversion by 9%", "Prioritized 3 roadmap bets"]
      }
    ],
    constraints: ["Avoid pure implementation-only roles", "Avoid heavy travel roles"],
    baseResume: "Alex Chen base resume content ...",
    learnedStrengths: ["Structured problem solving"],
    learnedSkillGaps: ["Technical collaboration depth"],
    successSignals: ["AI-native product framing lands well in interviews"],
    policyPreferences: {
      manualPreferredRoles: [],
      ignoredRiskyRoles: [],
      riskToleranceOverride: ""
    },
    createdAt: "2026-04-14T09:00:00.000Z",
    updatedAt: "2026-04-14T09:00:00.000Z"
  },
  strategyProfile: {
    id: "strategy_001",
    preferredRoles: ["AI Product Manager", "Product Strategy"],
    riskyRoles: ["Operations"],
    successPatterns: [
      "AI-native product roles convert better when product ownership is explicit.",
      "Strategy-heavy roles work when they still preserve product adjacency."
    ],
    failurePatterns: [
      "Operational leadership roles dilute the AI PM story and convert poorly."
    ],
    scoreBias: {
      roleBiases: {
        "AI Product Manager": 6,
        "Product Strategy": 2,
        Operations: -4
      },
      industryBiases: {
        AI: 6,
        Strategy: 1,
        Advertising: -6
      }
    },
    positiveSignals: [
      "AI-native product roles have the highest interview credibility.",
      "Strategy-heavy roles can still work when product adjacency is clear."
    ],
    cautionSignals: [
      "Pure ops leadership roles create low conversion and high story dilution risk."
    ],
    learnedFromInterviews: [
      "Sharpen technical collaboration stories before deeper rounds."
    ],
    updatedAt: "2026-04-14T09:00:00.000Z"
  },
  globalStrategyPolicy: {
    id: "policy_001",
    version: 1,
    appliedProposalId: "proposal_001",
    preferredRoles: ["AI Product Manager", "Product Strategy"],
    riskyRoles: ["Operations"],
    targetRolesPriority: ["AI Product Manager", "Product Strategy"],
    avoidPatterns: ["Operations leadership", "Advertising specialization"],
    preferredIndustries: ["AI", "Enterprise Software"],
    riskyIndustries: ["Advertising"],
    preferredLocations: ["Shanghai", "Beijing", "Remote"],
    riskyLocations: ["Shenzhen"],
    successPatterns: [
      "AI-native product roles convert better when product ownership is explicit.",
      "Strategy-heavy roles work when they still preserve product adjacency."
    ],
    failurePatterns: [
      "Operational leadership roles dilute the AI PM story and convert poorly."
    ],
    riskTolerance: "medium",
    focusMode: "focused",
    policySummary:
      "Keep the pipeline concentrated on AI PM and product-strategy roles with clear product ownership; avoid operational leadership distractions.",
    lastUpdatedAt: "2026-04-14T09:00:00.000Z",
    updatedAt: "2026-04-14T09:00:00.000Z"
  },
  policyHistory: [
    {
      id: "policylog_001",
      proposalId: "proposal_001",
      previousPolicySnapshot: null,
      nextPolicySnapshot: {
        id: "policy_001",
        version: 1,
        appliedProposalId: "proposal_001",
        preferredRoles: ["AI Product Manager", "Product Strategy"],
        riskyRoles: ["Operations"],
        preferredIndustries: ["AI", "Enterprise Software"],
        riskyIndustries: ["Advertising"],
        preferredLocations: ["Shanghai", "Beijing", "Remote"],
        riskyLocations: ["Shenzhen"],
        successPatterns: [
          "AI-native product roles convert better when product ownership is explicit."
        ],
        failurePatterns: [
          "Operational leadership roles dilute the AI PM story and convert poorly."
        ],
        targetRolesPriority: ["AI Product Manager", "Product Strategy"],
        avoidPatterns: ["Operations leadership", "Advertising specialization"],
        riskTolerance: "medium",
        focusMode: "focused",
        policySummary:
          "Keep the pipeline concentrated on AI PM and product-strategy roles with clear product ownership; avoid operational leadership distractions.",
        lastUpdatedAt: "2026-04-14T09:00:00.000Z",
        updatedAt: "2026-04-14T09:00:00.000Z"
      },
      summary: "Applied the initial policy after interview reflection and historical pipeline review.",
      createdAt: "2026-04-14T09:00:00.000Z"
    }
  ],
  policyProposals: [
    {
      id: "proposal_001",
      createdAt: "2026-04-14T09:00:00.000Z",
      triggerType: "interview_reflection",
      triggerSourceId: "reflection_001",
      oldPolicySnapshot: null,
      proposedPolicySnapshot: {
        id: "policy_001",
        version: 1,
        appliedProposalId: "proposal_001",
        preferredRoles: ["AI Product Manager", "Product Strategy"],
        riskyRoles: ["Operations"],
        preferredIndustries: ["AI", "Enterprise Software"],
        riskyIndustries: ["Advertising"],
        preferredLocations: ["Shanghai", "Beijing", "Remote"],
        riskyLocations: ["Shenzhen"],
        successPatterns: [
          "AI-native product roles convert better when product ownership is explicit."
        ],
        failurePatterns: [
          "Operational leadership roles dilute the AI PM story and convert poorly."
        ],
        targetRolesPriority: ["AI Product Manager", "Product Strategy"],
        avoidPatterns: ["Operations leadership", "Advertising specialization"],
        riskTolerance: "medium",
        focusMode: "focused",
        policySummary:
          "Keep the pipeline concentrated on AI PM and product-strategy roles with clear product ownership; avoid operational leadership distractions.",
        lastUpdatedAt: "2026-04-14T09:00:00.000Z",
        updatedAt: "2026-04-14T09:00:00.000Z"
      },
      diffSummary: [
        "Added AI Product Manager to preferredRoles.",
        "Added Product Strategy to preferredRoles.",
        "Changed focus mode from unset to focused."
      ],
      reasonSummary: "Policy narrowed toward AI PM and Product Strategy after positive interview reflection.",
      status: "applied",
      reviewerNote: "Initial baseline accepted.",
      appliedAt: "2026-04-14T09:00:00.000Z",
      revertedAt: null
    },
    {
      id: "proposal_002",
      createdAt: "2026-04-15T08:00:00.000Z",
      triggerType: "bad_case",
      triggerSourceId: "job_003",
      oldPolicySnapshot: {
        id: "policy_001",
        version: 1,
        appliedProposalId: "proposal_001",
        preferredRoles: ["AI Product Manager", "Product Strategy"],
        riskyRoles: ["Operations"],
        preferredIndustries: ["AI", "Enterprise Software"],
        riskyIndustries: ["Advertising"],
        preferredLocations: ["Shanghai", "Beijing", "Remote"],
        riskyLocations: ["Shenzhen"],
        successPatterns: [
          "AI-native product roles convert better when product ownership is explicit."
        ],
        failurePatterns: [
          "Operational leadership roles dilute the AI PM story and convert poorly."
        ],
        targetRolesPriority: ["AI Product Manager", "Product Strategy"],
        avoidPatterns: ["Operations leadership", "Advertising specialization"],
        riskTolerance: "medium",
        focusMode: "focused",
        policySummary:
          "Keep the pipeline concentrated on AI PM and product-strategy roles with clear product ownership; avoid operational leadership distractions.",
        lastUpdatedAt: "2026-04-14T09:00:00.000Z",
        updatedAt: "2026-04-14T09:00:00.000Z"
      },
      proposedPolicySnapshot: {
        id: "policy_001",
        version: 1,
        appliedProposalId: "proposal_001",
        preferredRoles: ["AI Product Manager", "Product Strategy"],
        riskyRoles: ["Operations"],
        preferredIndustries: ["AI", "Enterprise Software"],
        riskyIndustries: ["Advertising"],
        preferredLocations: ["Shanghai", "Beijing", "Remote"],
        riskyLocations: ["Shenzhen"],
        successPatterns: [
          "AI-native product roles convert better when product ownership is explicit."
        ],
        failurePatterns: [
          "Operational leadership roles dilute the AI PM story and convert poorly.",
          "Advertising-heavy operational roles show poor leverage."
        ],
        targetRolesPriority: ["AI Product Manager", "Product Strategy"],
        avoidPatterns: [
          "Operations leadership",
          "Advertising specialization",
          "Advertising-heavy operational roles show poor leverage."
        ],
        riskTolerance: "medium",
        focusMode: "focused",
        policySummary:
          "Stay highly concentrated on AI PM and Product Strategy roles and further downrank ad-heavy ops patterns.",
        lastUpdatedAt: "2026-04-15T08:00:00.000Z",
        updatedAt: "2026-04-15T08:00:00.000Z"
      },
      diffSummary: [
        "Added Advertising-heavy operational roles show poor leverage. to failurePatterns.",
        "Added Advertising-heavy operational roles show poor leverage. to avoidPatterns."
      ],
      reasonSummary: "Marked ad-heavy operational roles as riskier after consecutive low-value outcomes.",
      status: "pending",
      reviewerNote: null,
      appliedAt: null,
      revertedAt: null
    }
  ],
  policyAuditLogs: [
    {
      id: "audit_001",
      timestamp: "2026-04-14T09:00:00.000Z",
      eventType: "proposal_created",
      actor: "system",
      relatedProposalId: "proposal_001",
      summary: "Policy narrowed toward AI PM and Product Strategy after positive interview reflection."
    },
    {
      id: "audit_002",
      timestamp: "2026-04-14T09:00:00.000Z",
      eventType: "proposal_approved",
      actor: "user",
      relatedProposalId: "proposal_001",
      summary: "Approved proposal proposal_001."
    },
    {
      id: "audit_003",
      timestamp: "2026-04-14T09:00:00.000Z",
      eventType: "policy_applied",
      actor: "user",
      relatedProposalId: "proposal_001",
      summary: "Applied policy proposal proposal_001."
    }
  ],
  jobs: demoCuratedJobs,
  fitAssessments: [],
  applicationPreps: [],
  applicationTasks: [],
  interviewReflections: [],
  activityLogs: [],
  badCases: []
};

module.exports = { demoData };

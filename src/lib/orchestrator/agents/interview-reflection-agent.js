const { createId, nowIso } = require("../../utils/id");

function runInterviewReflectionAgent({ payload, profile }) {
  const questionsAsked = payload.questionsAsked || [];
  const notes = payload.notes || "";
  const lowerNotes = String(notes || "").toLowerCase();
  const failureReasons = [];
  const successSignals = ["Structured communication landed well."];
  const skillGaps = [];

  if (/technical|engineering|system/.test(lowerNotes)) {
    failureReasons.push("Technical depth was not concrete enough.");
    skillGaps.push("Technical collaboration storytelling");
  }

  if (/product sense|prioritization|roadmap/.test(lowerNotes)) {
    failureReasons.push("Product judgement examples need tighter evidence.");
    skillGaps.push("Prioritization narrative");
  }

  if (/strategy|structure|communication/.test(lowerNotes)) {
    successSignals.push("Structured strategy framing remains a strong signal.");
  }

  if (failureReasons.length === 0 && notes) {
    failureReasons.push(notes);
  }

  if (skillGaps.length === 0) {
    skillGaps.push("Technical collaboration storytelling");
  }

  return {
    id: createId("reflection"),
    jobId: payload.jobId,
    profileId: profile.id,
    roundName: payload.roundName || "Interview Round",
    interviewerType: payload.interviewerType || "Interviewer",
    interviewDate: payload.interviewDate || nowIso(),
    questionsAsked,
    answerHighlights: [
      "Demonstrated clear structure in responses.",
      "Connected prior experience to target role direction."
    ],
    failureReasons,
    successSignals,
    skillGaps,
    weakSpots: notes
      ? [notes]
      : ["Technical collaboration examples still need more specificity."],
    strengthsObserved: ["Clear communication", "Strong business framing"],
    improvementActions: [
      "Prepare one tighter engineering collaboration story.",
      "Add more concrete user problem discovery details."
    ],
    strategyFeedback: [
      "Continue prioritizing AI-native product and strategy roles.",
      "Sharpen technical narrative before deeper panels."
    ],
    summary:
      "Overall a constructive interview signal with clear strengths in structured thinking and room to improve technical detail.",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

module.exports = { runInterviewReflectionAgent };

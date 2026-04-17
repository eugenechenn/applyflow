const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");

function toParagraphs(items = [], options = {}) {
  return items
    .filter(Boolean)
    .map((item) =>
      new Paragraph({
        text: String(item),
        bullet: options.bullet ? { level: 0 } : undefined,
        spacing: { after: 120 }
      })
    );
}

function createSectionHeading(title) {
  return new Paragraph({
    text: title,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 }
  });
}

function safeName(value, fallback) {
  return String(value || "").trim() || fallback;
}

async function exportTailoredResumeDocx({ job, tailoringOutput, resumeDocument }) {
  const preview = tailoringOutput?.tailoredResumePreview || {};
  const applicationPrep = tailoringOutput?.applicationPrepSnapshot || {};
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: safeName(job?.title, "岗位定制简历"),
                bold: true,
                size: 34
              })
            ],
            spacing: { after: 160 }
          }),
          new Paragraph({
            text: `${safeName(job?.company, "目标公司")} · ${safeName(job?.location, "地点待确认")}`,
            spacing: { after: 240 }
          }),
          createSectionHeading("定制摘要"),
          new Paragraph({
            text: preview.summary || applicationPrep.tailoredSummary || "暂无定制摘要。",
            spacing: { after: 180 }
          }),
          createSectionHeading("为什么适合这个岗位"),
          new Paragraph({
            text: applicationPrep.whyMe || tailoringOutput.whyThisVersion || "暂无补充说明。",
            spacing: { after: 180 }
          }),
          createSectionHeading("核心关键词"),
          new Paragraph({
            text:
              (preview.keywords || applicationPrep.resumeTailoring?.targetKeywords || []).join(" / ") ||
              "暂无关键词。",
            spacing: { after: 180 }
          }),
          createSectionHeading("定制简历要点"),
          ...toParagraphs(
            preview.experienceBullets ||
              applicationPrep.resumeTailoring?.rewriteBullets?.map((item) => item.rewritten) ||
              [],
            { bullet: true }
          ),
          createSectionHeading("项目与亮点"),
          ...toParagraphs(preview.projectHighlights || [], { bullet: true }),
          createSectionHeading("技能"),
          new Paragraph({
            text: (preview.skills || resumeDocument?.structured?.skills || []).join(" / ") || "暂无技能整理。",
            spacing: { after: 180 }
          }),
          createSectionHeading("面试 / 沟通要点"),
          ...toParagraphs(applicationPrep.talkingPoints || [], { bullet: true }),
          createSectionHeading("投递附言"),
          new Paragraph({
            text: applicationPrep.coverNote || "暂无投递附言。",
            spacing: { after: 180 }
          })
        ]
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  const fileName = `${safeName(job?.company, "ApplyFlow")}-${safeName(job?.title, "定制简历")}.docx`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_");

  return {
    fileName,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer
  };
}

module.exports = {
  exportTailoredResumeDocx
};

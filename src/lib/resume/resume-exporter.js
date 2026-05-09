"use strict";

const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { validateExportDto } = require("../contracts/resume-export-contracts");

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

function extractBullets(entries = [], limit = 12) {
  return (Array.isArray(entries) ? entries : [])
    .flatMap((entry) => (Array.isArray(entry?.bullets) ? entry.bullets : []))
    .filter(Boolean)
    .slice(0, limit);
}

async function exportTailoredResumeDocx(exportDto = {}) {
  const validation = validateExportDto(exportDto);
  if (!validation.ok) {
    const error = new Error(`Invalid ExportDTO for DOCX export: ${validation.errors.join("; ")}`);
    error.code = "INVALID_EXPORT_DTO";
    error.details = { errors: validation.errors };
    throw error;
  }

  const profile = exportDto.profile || {};
  const sections = exportDto.sections || {};
  const workBullets = extractBullets(sections.workExperience, 12);
  const projectBullets = extractBullets(sections.projectExperience, 8);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: safeName(profile.targetRole, "Tailored Resume"),
                bold: true,
                size: 34
              })
            ],
            spacing: { after: 160 }
          }),
          new Paragraph({
            text: `${safeName(profile.targetCompany, "Target Company")} | ${safeName(
              profile.targetLocation,
              "Location TBD"
            )}`,
            spacing: { after: 240 }
          }),
          createSectionHeading("Summary"),
          new Paragraph({
            text: sections.summary || "No summary available.",
            spacing: { after: 180 }
          }),
          createSectionHeading("Why Fit"),
          new Paragraph({
            text: sections.whyFit || "No fit rationale available.",
            spacing: { after: 180 }
          }),
          createSectionHeading("Keywords"),
          new Paragraph({
            text: (sections.keywords || []).join(" / ") || "No keywords available.",
            spacing: { after: 180 }
          }),
          createSectionHeading("Experience Highlights"),
          ...toParagraphs(workBullets, { bullet: true }),
          createSectionHeading("Project Highlights"),
          ...toParagraphs(projectBullets, { bullet: true }),
          createSectionHeading("Skills"),
          new Paragraph({
            text: (sections.skills || []).join(" / ") || "No skills available.",
            spacing: { after: 180 }
          }),
          createSectionHeading("Talking Points"),
          ...toParagraphs(sections.talkingPoints || [], { bullet: true }),
          createSectionHeading("Cover Note"),
          new Paragraph({
            text: sections.coverNote || "No cover note available.",
            spacing: { after: 180 }
          })
        ]
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  const fileName = `${safeName(profile.targetCompany, "ApplyFlow")}-${safeName(
    profile.targetRole,
    "TailoredResume"
  )}.docx`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_");

  return {
    fileName,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
    warnings: []
  };
}

async function exportTailoredResumePdf(exportDto = {}) {
  const validation = validateExportDto(exportDto);
  if (!validation.ok) {
    const error = new Error(`Invalid ExportDTO for PDF export: ${validation.errors.join("; ")}`);
    error.code = "INVALID_EXPORT_DTO";
    error.details = { errors: validation.errors };
    throw error;
  }

  const profile = exportDto.profile || {};
  const sections = exportDto.sections || {};

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 48;
  const topY = 800;
  let y = topY;
  const lineHeight = 16;
  const sectionGap = 10;

  function drawLine(text = "", options = {}) {
    const value = String(text || "").trim();
    if (!value) return;
    const size = options.size || 11;
    const fontRef = options.bold ? boldFont : font;
    page.drawText(value, {
      x: marginX,
      y,
      size,
      font: fontRef,
      color: rgb(0.1, 0.1, 0.1)
    });
    y -= options.lineHeight || lineHeight;
  }

  function drawSection(title, lines = []) {
    drawLine(title, { bold: true, size: 12, lineHeight: 18 });
    lines.filter(Boolean).forEach((line) => drawLine(`- ${line}`));
    y -= sectionGap;
  }

  const workBullets = extractBullets(sections.workExperience, 10);
  const projectBullets = extractBullets(sections.projectExperience, 6);

  drawLine(safeName(profile.targetRole, "Tailored Resume"), { bold: true, size: 16, lineHeight: 22 });
  drawLine(
    `${safeName(profile.targetCompany, "Target Company")} | ${safeName(profile.targetLocation, "Location TBD")}`,
    { size: 11, lineHeight: 18 }
  );
  y -= 8;

  drawSection("Summary", [sections.summary || "No summary available."]);
  drawSection("Why Fit", [sections.whyFit || "No fit rationale available."]);
  drawSection("Keywords", [(sections.keywords || []).join(" / ") || "No keywords available."]);
  drawSection("Experience Highlights", workBullets.length ? workBullets : ["No experience highlights available."]);
  drawSection("Project Highlights", projectBullets.length ? projectBullets : ["No project highlights available."]);
  drawSection("Skills", [(sections.skills || []).join(" / ") || "No skills available."]);
  drawSection(
    "Talking Points",
    Array.isArray(sections.talkingPoints) && sections.talkingPoints.length
      ? sections.talkingPoints
      : ["No talking points available."]
  );
  drawSection("Cover Note", [sections.coverNote || "No cover note available."]);

  const bytes = await pdfDoc.save();
  const buffer = Buffer.from(bytes);
  const fileName = `${safeName(profile.targetCompany, "ApplyFlow")}-${safeName(
    profile.targetRole,
    "TailoredResume"
  )}.pdf`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_");

  return {
    fileName,
    contentType: "application/pdf",
    buffer,
    warnings: []
  };
}

module.exports = {
  exportTailoredResumeDocx,
  exportTailoredResumePdf
};

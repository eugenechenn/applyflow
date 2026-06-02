/*
 * 将三份面试主文档从 Markdown 同步导出为 Word。
 */
const fs = require("fs");
const path = require("path");
const {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} = require("docx");

const root = path.resolve(__dirname, "..");

const jobs = [
  {
    source: path.join(root, "interview", "00_先看这个：AI面试总控与复习路线.md"),
    target: path.join(root, "00 先看这个：AI 面试总控与复习路线.docx"),
  },
  {
    source: path.join(root, "interview", "01_ApplyFlow项目面试主线.md"),
    target: path.join(root, "01_ApplyFlow项目面试主线.docx"),
  },
  {
    source: path.join(root, "interview", "02_深挖问答与防守口径.md"),
    target: path.join(root, "02_深挖问答与防守口径.docx"),
  },
];

function cleanInline(value) {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .trim();
}

function paragraph(text, options = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...options,
    children: [new TextRun({ text: cleanInline(text), size: options.size || 22 })],
  });
}

function heading(text, level) {
  const map = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
  };
  return new Paragraph({
    heading: map[level] || HeadingLevel.HEADING_4,
    spacing: { before: 220, after: 120 },
    children: [new TextRun({ text: cleanInline(text), bold: true })],
  });
}

function isTableLine(line) {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseTable(lines, startIndex) {
  const rows = [];
  let index = startIndex;
  while (index < lines.length && isTableLine(lines[index])) {
    if (!isTableSeparator(lines[index])) {
      const cells = lines[index]
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cleanInline(cell));
      rows.push(cells);
    }
    index += 1;
  }
  return { rows, nextIndex: index };
}

function makeMobileTableBlocks(rows) {
  if (!rows.length) {
    return [];
  }
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const blocks = [paragraph("表格内容（手机友好版）：", { size: 21 })];
  if (!dataRows.length) {
    blocks.push(paragraph(headers.join("；")));
    return blocks;
  }
  dataRows.forEach((row, rowIndex) => {
    const pairs = headers.map((header, cellIndex) => {
      const value = row[cellIndex] || "";
      return `${header}：${value}`;
    });
    blocks.push(paragraph(`第 ${rowIndex + 1} 项：${pairs.join("；")}`, { bullet: { level: 0 } }));
  });
  return blocks;
}

function mdToDocxChildren(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const children = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isTableLine(line)) {
      const parsed = parseTable(lines, index);
      if (parsed.rows.length) {
        children.push(...makeMobileTableBlocks(parsed.rows));
        children.push(paragraph(""));
      }
      index = parsed.nextIndex;
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      children.push(heading(headingMatch[2], headingMatch[1].length));
      index += 1;
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bulletMatch) {
      children.push(paragraph(bulletMatch[1], { bullet: { level: 0 } }));
      index += 1;
      continue;
    }

    const numberedMatch = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (numberedMatch) {
      children.push(paragraph(numberedMatch[1], { numbering: { reference: "numbered-list", level: 0 } }));
      index += 1;
      continue;
    }

    const quoteMatch = /^>\s?(.+)$/.exec(trimmed);
    if (quoteMatch) {
      children.push(
        new Paragraph({
          indent: { left: 360 },
          spacing: { after: 120 },
          children: [new TextRun({ text: cleanInline(quoteMatch[1]), italics: true, size: 22 })],
        }),
      );
      index += 1;
      continue;
    }

    children.push(paragraph(trimmed));
    index += 1;
  }

  return children;
}

async function exportOne(job) {
  const markdown = fs.readFileSync(job.source, "utf8");
  const children = mdToDocxChildren(markdown);
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "numbered-list",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 480, hanging: 240 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, right: 900, bottom: 1080, left: 900 },
          },
        },
        children,
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(job.target, buffer);
  return { target: job.target, bytes: buffer.length };
}

(async () => {
  const results = [];
  for (const job of jobs) {
    results.push(await exportOne(job));
  }
  console.log(JSON.stringify({ exported: results }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

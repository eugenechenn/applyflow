const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_FEISHU_URL =
  "https://ycngqiyihgf7.feishu.cn/wiki/QltYwgdmPiOajAkVec6chqPenRb?table=tbl85D1q7YvI3RmO&view=vewh2m8QIt";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function normalizeText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickUrl(candidates = [], patterns = []) {
  for (const item of candidates) {
    if (!item?.url) continue;
    const lowered = `${item.url} ${item.text || ""}`.toLowerCase();
    if (patterns.some((pattern) => pattern.test(lowered))) {
      return item.url;
    }
  }
  return "";
}

function inferFieldFromText(text = "", headerHint = "") {
  const lowered = `${headerHint} ${text}`.toLowerCase();
  if (/(company|employer|organization|\u516c\u53f8|\u4f01\u4e1a)/i.test(lowered)) return "company";
  if (/(location|city|base|\u5730\u70b9|\u57ce\u5e02|\u5de5\u4f5c\u5730)/i.test(lowered)) return "location";
  if (/(title|job|position|role|\u5c97\u4f4d|\u804c\u4f4d)/i.test(lowered)) return "title";
  if (/(apply|submit|deliver|\u6295\u9012|\u7533\u8bf7)/i.test(lowered)) return "apply_url";
  if (/(notice|detail|jd|\u516c\u544a|\u8be6\u60c5)/i.test(lowered)) return "notice_url";
  return "";
}

function classifyRecord(record) {
  const missing = [];
  if (!record.company) missing.push("company");
  if (!record.location) missing.push("location");
  if (!record.title) missing.push("title");
  if (!record.apply_url && !record.notice_url) {
    missing.push("apply_url");
    missing.push("notice_url");
  }

  if (record.company && record.title && (record.apply_url || record.notice_url)) {
    return {
      eligibility: "candidate_input",
      missing_fields: missing,
      assessment_reason: "has_core_business_fields"
    };
  }

  if (record.company || record.title || record.location || record.apply_url || record.notice_url) {
    return {
      eligibility: "resolution",
      missing_fields: missing,
      assessment_reason: "partial_fields_need_enrichment"
    };
  }

  return {
    eligibility: "severe_missing",
    missing_fields: ["company", "location", "title", "apply_url", "notice_url"],
    assessment_reason: "no_row_business_signal_detected"
  };
}

async function main() {
  const args = parseArgs();
  const targetUrl = String(args.url || DEFAULT_FEISHU_URL).trim();

  const outputPath = path.resolve(process.cwd(), String(args.output || "feishu_visible_rows_probe.json"));
  const maxRows = Math.max(5, Math.min(30, Number(args.maxRows || 10)));
  const waitMs = Math.max(1000, Math.min(30000, Number(args.waitMs || 8000)));
  const headless = String(args.headless || "false").toLowerCase() === "true";

  const browser = await chromium.launch({ headless });
  const contextOptions = {};
  if (args.state) {
    const statePath = path.resolve(process.cwd(), String(args.state));
    if (fs.existsSync(statePath)) {
      contextOptions.storageState = statePath;
    }
  }
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(waitMs);

    if (args.manual) {
      console.log("Manual mode enabled. Please finish login/positioning in opened browser, then press Enter...");
      await new Promise((resolve) => process.stdin.once("data", resolve));
    }

    const probe = await page.evaluate(({ maxRows }) => {
      const toText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 20 && rect.height > 12;
      };

      const containerCandidates = Array.from(
        document.querySelectorAll(
          "[role='grid'], [role='table'], .table, .grid, .semi-table-body, .semi-table-content, [data-testid*='table'], [class*='table-body'], [class*='grid-body']"
        )
      )
        .filter(isVisible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const cellCount = el.querySelectorAll("[role='gridcell'], [role='cell'], td, .semi-table-row-cell, [class*='cell']").length;
          const rowCount = el.querySelectorAll("[role='row'], tr, .semi-table-row, [class*='row']").length;
          const score = cellCount * 2 + rowCount;
          return {
            el,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            score
          };
        })
        .sort((a, b) => b.score - a.score);

      const container = containerCandidates[0]?.el || null;
      const containerRect = container ? container.getBoundingClientRect() : null;

      const headerTexts = container
        ? Array.from(container.querySelectorAll("[role='columnheader'], th, .semi-table-header-cell, [class*='header-cell']")).map((node) =>
            toText(node.textContent || "")
          )
        : [];

      const rowNodes = container
        ? Array.from(container.querySelectorAll("[role='row'], tr, .semi-table-row, [class*='table-row']")).filter(isVisible)
        : [];

      const visibleRows = rowNodes
        .map((row) => {
          const rect = row.getBoundingClientRect();
          const inContainer =
            !containerRect ||
            (rect.bottom >= containerRect.top &&
              rect.top <= containerRect.bottom &&
              rect.right >= containerRect.left &&
              rect.left <= containerRect.right);
          if (!inContainer) return null;

          const cellNodes = Array.from(
            row.querySelectorAll("[role='gridcell'], [role='cell'], td, .semi-table-row-cell, [class*='cell']")
          ).filter(isVisible);

          const cells = cellNodes.map((cell, index) => ({
            index,
            text: toText(cell.textContent || ""),
            headerHint: headerTexts[index] || "",
            links: Array.from(cell.querySelectorAll("a[href]")).map((a) => ({
              text: toText(a.textContent || ""),
              url: a.href
            }))
          }));

          return {
            rowTop: rect.top,
            rowText: toText(row.textContent || ""),
            cells
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.rowTop - b.rowTop)
        .slice(0, maxRows);

      return {
        detectedContainer: container
          ? {
              tag: container.tagName,
              className: container.className || "",
              role: container.getAttribute("role") || "",
              rect: containerRect
                ? {
                    x: containerRect.x,
                    y: containerRect.y,
                    width: containerRect.width,
                    height: containerRect.height
                  }
                : null
            }
          : null,
        headerTexts,
        visibleRows
      };
    }, { maxRows });

    const normalizedRows = probe.visibleRows.map((row, index) => {
      const flattenedLinks = row.cells.flatMap((cell) => cell.links || []);
      const mapped = {
        row_index: index + 1,
        company: "",
        location: "",
        title: "",
        apply_url: "",
        notice_url: "",
        raw_cells: row.cells.map((cell) => ({
          index: cell.index,
          header_hint: cell.headerHint || "",
          text: normalizeText(cell.text),
          links: (cell.links || []).map((item) => ({
            text: normalizeText(item.text),
            url: item.url
          }))
        }))
      };

      for (const cell of row.cells) {
        const cellText = normalizeText(cell.text);
        const field = inferFieldFromText(cellText, cell.headerHint);
        if (!field) continue;
        if (field === "apply_url" || field === "notice_url") continue;
        if (!mapped[field] && cellText) mapped[field] = cellText;
      }

      mapped.apply_url = pickUrl(flattenedLinks, [/(apply|submit|deliver|resume|cv|\u6295\u9012|\u7533\u8bf7)/i]) || "";
      mapped.notice_url =
        pickUrl(flattenedLinks, [/(notice|detail|jd|job|\u516c\u544a|\u8be6\u60c5|\u5c97\u4f4d)/i]) ||
        (flattenedLinks.find((item) => item.url !== mapped.apply_url)?.url || "");

      const decision = classifyRecord(mapped);
      return { ...mapped, ...decision };
    });

    const result = {
      captured_at: new Date().toISOString(),
      mode: "visible_rows_only",
      source_url: page.url(),
      strategy: {
        no_body_inner_text: true,
        detect_scroll_container: true,
        only_visible_rows: true
      },
      probe: {
        detected_container: probe.detectedContainer,
        header_texts: probe.headerTexts || [],
        visible_row_count: normalizedRows.length
      },
      rows: normalizedRows
    };

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
    console.log(
      JSON.stringify(
        {
          output: outputPath,
          visible_row_count: normalizedRows.length,
          sample: normalizedRows.slice(0, 3).map((row) => ({
            row_index: row.row_index,
            company: row.company,
            location: row.location,
            title: row.title,
            apply_url: row.apply_url,
            notice_url: row.notice_url,
            eligibility: row.eligibility
          }))
        },
        null,
        2
      )
    );
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[probe-feishu-visible-rows] failed:", error.message);
  process.exit(1);
});

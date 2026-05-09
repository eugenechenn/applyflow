"use strict";

/**
 * 验证批次并行调度器
 * - 不改变各子验证脚本语义
 * - 仅调整执行编排以缩短总耗时
 */

const { spawn } = require("child_process");

function now() {
  return new Date().toISOString();
}

function toList(value) {
  return Array.isArray(value) ? value : [];
}

function parseArgs(argv = []) {
  const args = toList(argv).map((item) => String(item || "").trim()).filter(Boolean);
  const getArg = (flag, fallback) => {
    const inline = args.find((item) => item.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1) || fallback;
    const index = args.indexOf(flag);
    if (index >= 0 && index + 1 < args.length) return args[index + 1];
    return fallback;
  };

  const mode = String(getArg("--mode", "fast") || "fast").trim().toLowerCase();
  const maxParallel = Math.max(1, Number(getArg("--max-parallel", "3")) || 3);
  return {
    mode: ["fast", "full"].includes(mode) ? mode : "fast",
    maxParallel
  };
}

function runNpmScript(scriptName) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", scriptName], {
      stdio: "inherit",
      shell: true
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`script failed: ${scriptName} (exit ${code})`));
    });
  });
}

async function runGroup(groupName, scripts, maxParallel = 3) {
  const queue = toList(scripts).slice();
  if (queue.length === 0) return;
  console.log(`[${now()}] [validate-batch] group=${groupName} started, jobs=${queue.length}, maxParallel=${maxParallel}`);

  let cursor = 0;
  let running = 0;
  let failed = false;

  await new Promise((resolve, reject) => {
    const schedule = () => {
      if (failed) return;
      if (cursor >= queue.length && running === 0) {
        console.log(`[${now()}] [validate-batch] group=${groupName} finished`);
        resolve();
        return;
      }

      while (running < maxParallel && cursor < queue.length) {
        const scriptName = queue[cursor];
        cursor += 1;
        running += 1;
        console.log(`[${now()}] [validate-batch] -> ${scriptName}`);
        runNpmScript(scriptName)
          .then(() => {
            running -= 1;
            schedule();
          })
          .catch((error) => {
            failed = true;
            reject(error);
          });
      }
    };
    schedule();
  });
}

function buildPlan(mode = "fast") {
  const base = [
    "lint",
    "typecheck",
    "build",
    "validate:schema"
  ];

  const fastGroups = [
    {
      name: "static-ui-fixtures",
      parallel: 3,
      scripts: ["validate:contamination", "validate:fixtures", "validate:ui-boundary", "validate:ui-recovery-guard", "validate:ui-route-smoke", "validate:ui-dirty-data-smoke"]
    },
    {
      name: "discovery-db-seq",
      parallel: 1,
      scripts: ["validate:discovery-contracts", "validate:discovery-lead-ingestion", "validate:discovery-feishu-adapter", "validate:discovery-feishu-sync", "validate:discovery-offline-json-adapter"]
    },
    {
      name: "ranking-db-seq",
      parallel: 1,
      scripts: ["validate:job-scoring-derived-view", "validate:discovery-dedup", "validate:discovery-batch-decision", "validate:discovery-ranking", "validate:discovery-shortlist", "validate:discovery-admission"]
    },
    {
      name: "execution-db-seq",
      parallel: 1,
      scripts: ["validate:execution-contracts", "validate:browser-apply-skeleton", "validate:browser-generic-html-form", "validate:browser-apply-ui"]
    },
    {
      name: "resume-export-db-seq",
      parallel: 1,
      scripts: ["validate:resume-export-contracts", "validate:resume-export-mapping", "validate:resume-docx-export", "validate:resume-pdf-export"]
    },
    {
      name: "resume-master-db-seq",
      parallel: 1,
      scripts: ["validate:master-resume-read", "validate:master-resume-save", "validate:master-resume-tailoring-source", "validate:prep-resume-readiness", "validate:jobs-apply-ui"]
    },
    {
      name: "ui-edge-static",
      parallel: 3,
      scripts: ["validate:autofill-profile-structure", "validate:profile-autofill-enhanced-ui", "validate:layout-ia", "validate:edge-extension-mvp", "validate:edge-semantic-slots", "validate:edge-autofill-regression", "validate:edge-multi-segment-passive"]
    }
  ];

  if (mode === "fast") {
    return {
      base,
      groups: fastGroups,
      tail: []
    };
  }

  const fullTail = [
    "validate:ui-runtime-smoke",
    "validate:ui-user-flow-smoke",
    "validate:discovery-offline-json-jobs-seed",
    "validate:job-llm-scoring-layer",
    "validate:discovery-fullchain-e2e",
    "validate:execution-e2e",
    "validate:export-e2e"
  ];

  return {
    base,
    groups: fastGroups,
    tail: fullTail
  };
}

async function main() {
  const { mode, maxParallel } = parseArgs(process.argv.slice(2));
  const plan = buildPlan(mode);
  console.log(`[${now()}] [validate-batch] mode=${mode}, maxParallel=${maxParallel}`);

  for (const scriptName of plan.base) {
    console.log(`[${now()}] [validate-batch] -> ${scriptName}`);
    await runNpmScript(scriptName);
  }

  for (let index = 0; index < plan.groups.length; index += 1) {
    const group = plan.groups[index];
    await runGroup(
      group.name || `g${index + 1}`,
      group.scripts || [],
      Math.max(1, Number(group.parallel || maxParallel))
    );
  }

  for (const scriptName of plan.tail) {
    console.log(`[${now()}] [validate-batch] -> ${scriptName}`);
    await runNpmScript(scriptName);
  }

  console.log(`[${now()}] [validate-batch] all done`);
}

main().catch((error) => {
  console.error(`[${now()}] [validate-batch] failed:`, error?.message || error);
  process.exitCode = 1;
});

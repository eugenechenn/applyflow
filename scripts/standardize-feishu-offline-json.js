#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_INPUT_GLOB = /^feishu_records_\d+\.json$/;
const DEFAULT_OUTPUT = path.join('data', 'standardized_feishu_records.json');

const FIELD_MAP = {
  company: 'fld5EAAE00',
  title: 'fldkTXcI7e',
  locationOption: 'fldH1OIoGV',
  applyPrimary: 'fldWQv0UQJ',
  noticePrimary: 'fldASsdd73',
  applyBackup: 'fldNXPZRIL',
  cohortText: 'fldoEcT29F',
  deadlineText: 'fldnJj01hF'
};

function parseArgs(argv) {
  const args = {
    inputDir: '.',
    output: DEFAULT_OUTPUT,
    files: null
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--inputDir' && argv[i + 1]) {
      args.inputDir = argv[i + 1];
      i += 1;
    } else if (token === '--output' && argv[i + 1]) {
      args.output = argv[i + 1];
      i += 1;
    } else if (token === '--files' && argv[i + 1]) {
      args.files = argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
    }
  }

  return args;
}

function readJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001F]/g, ' ')
    .trim();
}

function extractTextValue(fieldObj) {
  const value = fieldObj && fieldObj.value;
  if (value == null) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return normalizeWhitespace(value);
  }

  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) {
      if (item == null) {
        continue;
      }
      if (typeof item === 'string' || typeof item === 'number') {
        parts.push(String(item));
      } else if (typeof item === 'object') {
        if (typeof item.text === 'string' && item.text.trim()) {
          parts.push(item.text);
        } else if (typeof item.link === 'string' && item.link.trim()) {
          parts.push(item.link);
        }
      }
    }
    return normalizeWhitespace(parts.join(' | '));
  }

  if (typeof value === 'object') {
    if (typeof value.text === 'string' && value.text.trim()) {
      return normalizeWhitespace(value.text);
    }
    if (typeof value.link === 'string' && value.link.trim()) {
      return normalizeWhitespace(value.link);
    }
  }

  return '';
}

function looksLikeUrl(text) {
  return /^https?:\/\//i.test(String(text || '').trim());
}

function extractUrlsFromField(fieldObj) {
  const value = fieldObj && fieldObj.value;
  const urls = [];

  const pushUrl = (u) => {
    const clean = normalizeWhitespace(u);
    if (!clean || !looksLikeUrl(clean)) {
      return;
    }
    urls.push(clean);
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item == null) {
        continue;
      }
      if (typeof item === 'string') {
        pushUrl(item);
      } else if (typeof item === 'object') {
        if (typeof item.link === 'string') {
          pushUrl(item.link);
        }
        if (typeof item.text === 'string' && looksLikeUrl(item.text)) {
          pushUrl(item.text);
        }
      }
    }
  } else if (typeof value === 'string' && looksLikeUrl(value)) {
    pushUrl(value);
  } else if (value && typeof value === 'object') {
    if (typeof value.link === 'string') {
      pushUrl(value.link);
    }
    if (typeof value.text === 'string' && looksLikeUrl(value.text)) {
      pushUrl(value.text);
    }
  }

  return Array.from(new Set(urls));
}

function extractOptionIds(fieldObj) {
  const value = fieldObj && fieldObj.value;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v) => typeof v === 'string' && v.startsWith('opt'));
}

function isLikelyNoticeUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u) {
    return false;
  }

  const noticeHosts = [
    'mp.weixin.qq.com',
    'weixin.qq.com',
    'news.',
    '/notice',
    '/announcement',
    '/article',
    '/wiki/'
  ];

  return noticeHosts.some((token) => u.includes(token));
}

function isLikelyApplyUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u) {
    return false;
  }

  const applyTokens = [
    'zhiye.com',
    'campus',
    'jobs',
    'careers',
    'career',
    'recruit',
    'apply',
    'job',
    'position',
    'jobs.feishu.cn',
    'wjx.top',
    'iguopin.com'
  ];

  return applyTokens.some((token) => u.includes(token));
}

function uniq(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function pickPrimaryLinks(allLinks, preferredLinks) {
  for (const l of preferredLinks) {
    if (allLinks.includes(l)) {
      return l;
    }
  }
  return preferredLinks[0] || null;
}

function resolveLinks(rawLinks) {
  const unique = uniq(rawLinks);
  if (unique.length === 0) {
    return {
      applyUrl: null,
      noticeUrl: null,
      status: 'no_link',
      rawLinks: []
    };
  }

  const applyCandidates = unique.filter(isLikelyApplyUrl);
  const noticeCandidates = unique.filter(isLikelyNoticeUrl);

  const hasApply = applyCandidates.length > 0;
  const hasNotice = noticeCandidates.length > 0;

  let applyUrl = null;
  let noticeUrl = null;
  let status = 'unclear_kept';

  if (hasApply && hasNotice) {
    applyUrl = pickPrimaryLinks(unique, applyCandidates);
    noticeUrl = pickPrimaryLinks(unique, noticeCandidates.filter((n) => n !== applyUrl));
    if (!noticeUrl && noticeCandidates[0]) {
      noticeUrl = noticeCandidates[0];
    }
    status = 'both_kept';
  } else if (hasApply) {
    applyUrl = pickPrimaryLinks(unique, applyCandidates);
    status = 'apply_only';
  } else if (hasNotice) {
    noticeUrl = pickPrimaryLinks(unique, noticeCandidates);
    applyUrl = null;
    status = 'notice_only';
  } else {
    applyUrl = unique[0] || null;
    status = 'unclear_kept';
  }

  if (!applyUrl && unique[0] && status === 'unclear_kept') {
    applyUrl = unique[0];
  }

  return {
    applyUrl,
    noticeUrl,
    status,
    rawLinks: unique
  };
}

function buildRawText(parts) {
  return normalizeWhitespace(parts.filter(Boolean).join(' | '));
}

function buildRouting(record) {
  const hasCompany = Boolean(record.company);
  const hasTitle = Boolean(record.title);
  const hasLink = Boolean(record.apply_url || record.notice_url);
  const status = record.link_resolution_status;

  if (!hasCompany && !hasTitle && !hasLink) {
    return 'severe_missing';
  }

  if (status === 'notice_only') {
    return 'resolution';
  }

  if (hasCompany && hasTitle && hasLink) {
    return 'candidate_input';
  }

  if ((hasCompany || hasTitle) && hasLink) {
    return 'resolution';
  }

  if (hasCompany && hasTitle && !hasLink) {
    return 'resolution';
  }

  return 'severe_missing';
}

function scoreRecord(r) {
  let s = 0;
  if (r.company) s += 4;
  if (r.title) s += 4;
  if (r.apply_url) s += 4;
  if (r.notice_url) s += 2;
  if (r.raw_text) s += 1;
  return s;
}

function toStandardized(recordId, recordMapEntry, sourceFile, tableID) {
  const company = extractTextValue(recordMapEntry[FIELD_MAP.company]);
  const title = extractTextValue(recordMapEntry[FIELD_MAP.title]);

  const locationOptionIds = extractOptionIds(recordMapEntry[FIELD_MAP.locationOption]);
  const locationText = extractTextValue(recordMapEntry[FIELD_MAP.locationOption]);
  const normalizedLocationText = normalizeWhitespace(locationText);
  const locationLooksLikeOptionId = /^opt[A-Za-z0-9]+(?:\s*\|\s*opt[A-Za-z0-9]+)*$/.test(normalizedLocationText);
  const location = normalizedLocationText && !locationLooksLikeOptionId ? normalizedLocationText : null;

  const linkPool = uniq([
    ...extractUrlsFromField(recordMapEntry[FIELD_MAP.applyPrimary]),
    ...extractUrlsFromField(recordMapEntry[FIELD_MAP.noticePrimary]),
    ...extractUrlsFromField(recordMapEntry[FIELD_MAP.applyBackup])
  ]);

  const linkResolved = resolveLinks(linkPool);

  const cohortText = extractTextValue(recordMapEntry[FIELD_MAP.cohortText]);
  const deadlineText = extractTextValue(recordMapEntry[FIELD_MAP.deadlineText]);
  const rawText = buildRawText([company, title, cohortText, deadlineText]);

  const standardized = {
    source: 'feishu_offline_json',
    sourceJobId: recordId,
    company: company || null,
    title: title || null,
    location: location || null,
    apply_url: linkResolved.applyUrl,
    notice_url: linkResolved.noticeUrl,
    raw_text: rawText || null,
    fetchMeta: {
      provider: 'feishu_offline_json',
      snapshotFile: sourceFile,
      tableID: tableID || null,
      importedAt: new Date().toISOString(),
      rawLinks: linkResolved.rawLinks,
      optionIds: {
        location: locationOptionIds
      }
    },
    link_resolution_status: linkResolved.status,
    routing: 'resolution'
  };

  standardized.routing = buildRouting(standardized);

  return standardized;
}

function chooseBest(existing, incoming) {
  if (!existing) {
    return incoming;
  }
  const a = scoreRecord(existing);
  const b = scoreRecord(incoming);
  if (b > a) {
    return incoming;
  }
  if (b < a) {
    return existing;
  }

  const existingLinks = (existing.fetchMeta && existing.fetchMeta.rawLinks ? existing.fetchMeta.rawLinks.length : 0);
  const incomingLinks = (incoming.fetchMeta && incoming.fetchMeta.rawLinks ? incoming.fetchMeta.rawLinks.length : 0);
  if (incomingLinks > existingLinks) {
    return incoming;
  }

  return existing;
}

function main() {
  const args = parseArgs(process.argv);
  const inputDirAbs = path.resolve(args.inputDir);
  const outputAbs = path.resolve(args.output);

  const files = args.files && args.files.length
    ? args.files
    : fs.readdirSync(inputDirAbs).filter((f) => DEFAULT_INPUT_GLOB.test(f)).sort();

  if (files.length === 0) {
    throw new Error('No feishu_records_*.json files found.');
  }

  const mergedById = new Map();

  for (const file of files) {
    const filePath = path.join(inputDirAbs, file);
    const json = readJson(filePath);
    const tableID = json.tableID || null;
    const recordMap = json.recordMap || {};

    for (const [recordId, recordMapEntry] of Object.entries(recordMap)) {
      const standardized = toStandardized(recordId, recordMapEntry, file, tableID);
      const existing = mergedById.get(recordId);
      mergedById.set(recordId, chooseBest(existing, standardized));
    }
  }

  const standardizedRecords = Array.from(mergedById.values())
    .sort((a, b) => a.sourceJobId.localeCompare(b.sourceJobId));

  const stats = {
    total_records: standardizedRecords.length,
    candidate_input: standardizedRecords.filter((r) => r.routing === 'candidate_input').length,
    resolution: standardizedRecords.filter((r) => r.routing === 'resolution').length,
    severe_missing: standardizedRecords.filter((r) => r.routing === 'severe_missing').length,
    apply_url_non_empty: standardizedRecords.filter((r) => Boolean(r.apply_url)).length,
    notice_url_non_empty: standardizedRecords.filter((r) => Boolean(r.notice_url)).length,
    both_kept: standardizedRecords.filter((r) => r.link_resolution_status === 'both_kept').length,
    unclear_kept: standardizedRecords.filter((r) => r.link_resolution_status === 'unclear_kept').length
  };

  const outputPayload = {
    generatedAt: new Date().toISOString(),
    source: 'feishu_offline_json',
    inputFiles: files,
    stats,
    records: standardizedRecords
  };

  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });
  fs.writeFileSync(outputAbs, JSON.stringify(outputPayload, null, 2), 'utf8');

  console.log(JSON.stringify({
    output: outputAbs,
    stats
  }, null, 2));
}

main();

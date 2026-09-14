#!/usr/bin/env node
/**
 * Compare pinned upstream versions vs latest; update unofficial Chinese
 * cheatsheet version pills / notices / homepage cards when newer.
 * Zero npm dependencies — uses global fetch (Node 18+).
 *
 * Usage (from repo root):
 *   node scripts/upstream/sync.mjs
 *   node scripts/upstream/sync.mjs --dry-run
 *   node scripts/upstream/sync.mjs --force
 *   UPSTREAM_ONLY=hermes-agent,trellis node scripts/upstream/sync.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const CONFIG_PATH = join(__dirname, "config.json");
const DEFAULT_REPORT_PATH = join(__dirname, "last-sync-report.json");

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const FORCE = args.has("--force");
const ONLY = (process.env.UPSTREAM_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const REPORT_PATH = process.env.SYNC_REPORT_PATH
  ? resolve(process.env.SYNC_REPORT_PATH)
  : DEFAULT_REPORT_PATH;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function notice(msg) {
  console.log(`::notice::${msg}`);
  console.log(msg);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeBasicEntities(text) {
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripHtmlToText(html) {
  let s = decodeBasicEntities(html);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>/gi, "\n\n");
  s = s.replace(/<\/(h[1-6]|li|blockquote|div|tr)>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "- ");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function linkifyEscaped(escaped) {
  return escaped.replace(
    /(https?:\/\/[^\s<&]+)/g,
    '<a href="$1" target="_blank" rel="noreferrer">$1</a>',
  );
}

function notesToSafeHtml(plainNotes, { maxChars = 4000 } = {}) {
  let text = String(plainNotes || "").trim();
  if (!text) {
    return "<p>（上游未提供发布说明）</p>";
  }
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars).trim()}…`;
  }
  const blocks = text.split(/\n{2,}/);
  const parts = blocks.map((block) => {
    const lines = block.split("\n").map((line) => linkifyEscaped(escapeHtml(line)));
    return `<p>${lines.join("<br>\n")}</p>`;
  });
  return parts.join("\n");
}

function normalizeVersion(raw) {
  if (raw == null) return "";
  return String(raw).trim().replace(/^v/i, "");
}

/**
 * Compare versions/tags. Returns >0 if a>b, <0 if a<b, 0 if equal/unknown-equal.
 * Handles classic semver and calendar-ish tags like 2026.9.11.
 */
function compareVersions(a, b) {
  const na = normalizeVersion(a);
  const nb = normalizeVersion(b);
  if (!na && !nb) return 0;
  if (!na) return -1;
  if (!nb) return 1;
  if (na === nb) return 0;

  const pa = na.split(/[.+_-]/).map((p) => p.trim()).filter(Boolean);
  const pb = nb.split(/[.+_-]/).map((p) => p.trim()).filter(Boolean);
  const len = Math.max(pa.length, pb.length);

  const preRank = (tok) => {
    const m = /^(alpha|beta|rc|pre|preview|dev|canary)(\d*)$/i.exec(tok);
    if (!m) return null;
    const kind = { alpha: 1, beta: 2, rc: 3, pre: 1, preview: 1, dev: 0, canary: 1 }[
      m[1].toLowerCase()
    ];
    return { kind, n: Number(m[2] || 0) };
  };

  for (let i = 0; i < len; i++) {
    const xa = pa[i] ?? "0";
    const xb = pb[i] ?? "0";
    const numa = /^\d+$/.test(xa);
    const numb = /^\d+$/.test(xb);
    if (numa && numb) {
      const da = Number(xa);
      const db = Number(xb);
      if (da !== db) return da > db ? 1 : -1;
      continue;
    }
    const pra = preRank(xa);
    const prb = preRank(xb);
    if (pra || prb) {
      // numeric release > prerelease token in same slot
      if (numa && prb) return 1;
      if (pra && numb) return -1;
      if (pra && prb) {
        if (pra.kind !== prb.kind) return pra.kind > prb.kind ? 1 : -1;
        if (pra.n !== prb.n) return pra.n > prb.n ? 1 : -1;
        continue;
      }
    }
    if (xa !== xb) return xa > xb ? 1 : -1;
  }
  return 0;
}

function isNewer(latest, pinned) {
  return compareVersions(latest, pinned) > 0;
}

async function githubApi(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "sunnirvana-cheatsheet-upstream-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 403 || res.status === 429) {
    const body = await res.text();
    const err = new Error(`GitHub API rate-limited: ${res.status}`);
    err.rateLimited = true;
    err.body = body;
    throw err;
  }
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`GitHub API ${res.status} for ${path}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function parseAtomFirstEntry(xml) {
  const entry = /<entry>([\s\S]*?)<\/entry>/i.exec(xml)?.[1];
  if (!entry) return null;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(entry)?.[1]?.trim() || "";
  const link =
    /<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i.exec(entry)?.[1] ||
    /<link[^>]+href="([^"]+)"[^>]*rel="alternate"/i.exec(entry)?.[1] ||
    /<link[^>]+href="([^"]+)"/i.exec(entry)?.[1] ||
    "";
  const contentRaw =
    /<content[^>]*>([\s\S]*?)<\/content>/i.exec(entry)?.[1]?.trim() || "";
  const id = /<id[^>]*>([\s\S]*?)<\/id>/i.exec(entry)?.[1]?.trim() || "";
  let tag = "";
  const tagFromLink = /\/releases\/tag\/([^/?#]+)/.exec(link);
  if (tagFromLink) tag = decodeURIComponent(tagFromLink[1]);
  else {
    const tagFromId = /\/([^/]+)$/.exec(id);
    if (tagFromId) tag = tagFromId[1];
  }
  const notesHtml = decodeBasicEntities(contentRaw);
  const notesText = stripHtmlToText(notesHtml);
  return { title: decodeBasicEntities(title), htmlUrl: link, tag, notesText };
}

async function fetchGithubLatestRelease(repo) {
  try {
    const data = await githubApi(`/repos/${repo}/releases/latest`);
    return {
      tag: data.tag_name,
      title: data.name || data.tag_name,
      htmlUrl: data.html_url,
      notesText: data.body || "",
      source: "api",
    };
  } catch (err) {
    if (!err.rateLimited && err.status !== 404) {
      // fall through to atom for other errors too
    }
    const atomUrl = `https://github.com/${repo}/releases.atom`;
    const res = await fetch(atomUrl, {
      headers: { "User-Agent": "sunnirvana-cheatsheet-upstream-sync" },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch releases.atom for ${repo}: ${res.status}`);
    }
    const xml = await res.text();
    const entry = parseAtomFirstEntry(xml);
    if (!entry?.tag) {
      throw new Error(`No release entries in atom feed for ${repo}`);
    }
    return {
      tag: entry.tag,
      title: entry.title,
      htmlUrl: entry.htmlUrl || `https://github.com/${repo}/releases/tag/${entry.tag}`,
      notesText: entry.notesText,
      source: "atom",
    };
  }
}

async function fetchGithubTagRelease(repo, tag) {
  const encoded = encodeURIComponent(tag);
  try {
    const data = await githubApi(`/repos/${repo}/releases/tags/${encoded}`);
    return {
      tag: data.tag_name,
      title: data.name || data.tag_name,
      htmlUrl: data.html_url,
      notesText: data.body || "",
      source: "api",
    };
  } catch {
    // Scan atom for matching tag (first few entries)
    const res = await fetch(`https://github.com/${repo}/releases.atom`, {
      headers: { "User-Agent": "sunnirvana-cheatsheet-upstream-sync" },
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => m[0]);
    for (const block of entries) {
      const parsed = parseAtomFirstEntry(`<feed>${block}</feed>`);
      if (parsed && (parsed.tag === tag || parsed.tag === `v${normalizeVersion(tag)}`)) {
        return {
          tag: parsed.tag,
          title: parsed.title,
          htmlUrl: parsed.htmlUrl,
          notesText: parsed.notesText,
          source: "atom",
        };
      }
    }
    return null;
  }
}

async function fetchDefaultBranchSha(repo, branch = "main") {
  try {
    const data = await githubApi(`/repos/${repo}/commits/${encodeURIComponent(branch)}`);
    const sha = data.sha || data.commit?.tree?.sha;
    if (!sha) return null;
    return { sha, short: sha.slice(0, 7), source: "api" };
  } catch {
    try {
      const res = await fetch(`https://github.com/${repo}/commits/${branch}.atom`, {
        headers: { "User-Agent": "sunnirvana-cheatsheet-upstream-sync" },
      });
      if (!res.ok) return null;
      const xml = await res.text();
      const id = /<entry>[\s\S]*?<id[^>]*>[\s\S]*?\/([0-9a-f]{7,40})<\/id>/i.exec(xml)?.[1];
      const link = /<entry>[\s\S]*?<link[^>]+href="([^"]+\/commit\/[0-9a-f]{7,40})"/i.exec(
        xml,
      )?.[1];
      const shaFromLink = link && /\/commit\/([0-9a-f]{7,40})/i.exec(link)?.[1];
      const sha = shaFromLink || id;
      if (!sha) return null;
      return { sha, short: sha.slice(0, 7), source: "atom" };
    } catch {
      return null;
    }
  }
}

async function fetchNpmPackageLatest(pkg) {
  const res = await fetch(`https://registry.npmjs.org/${pkg}`, {
    headers: { Accept: "application/json", "User-Agent": "sunnirvana-cheatsheet-upstream-sync" },
  });
  if (!res.ok) throw new Error(`npm registry ${res.status} for ${pkg}`);
  const data = await res.json();
  const version = data["dist-tags"]?.latest;
  if (!version) throw new Error(`No dist-tags.latest for ${pkg}`);
  const meta = data.versions?.[version] || {};
  const desc = meta.description || data.description || "";
  return {
    version,
    description: desc,
    htmlUrl: `https://www.npmjs.com/package/${pkg}/v/${version}`,
    notesText: `${pkg}@${version}\n\n${desc}`.trim(),
  };
}

function extractSemverFromTitle(title, fallbackTag) {
  const m =
    /\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(title || "") ||
    /\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(fallbackTag || "");
  return m ? m[1] : normalizeVersion(fallbackTag);
}

async function resolveLatest(source) {
  if (source.versionStrategy === "npm") {
    const npm = await fetchNpmPackageLatest(source.npmPackage);
    let notes = npm.notesText;
    let htmlUrl = npm.htmlUrl;
    let title = `${source.npmPackage}@${npm.version}`;
    const tag = `v${npm.version}`;
    // Prefer matching GitHub release notes when available
    try {
      const rel = await fetchGithubTagRelease(source.githubRepo, tag);
      if (rel) {
        notes = rel.notesText || notes;
        htmlUrl = rel.htmlUrl || htmlUrl;
        title = rel.title || title;
      }
    } catch {
      /* optional */
    }
    return {
      version: npm.version,
      tag,
      title,
      htmlUrl,
      notesText: notes,
      commit: null,
      commitShort: null,
    };
  }

  // github-release
  const rel = await fetchGithubLatestRelease(source.githubRepo);
  const version = source.semverFromReleaseTitle
    ? extractSemverFromTitle(rel.title, rel.tag)
    : normalizeVersion(rel.tag);
  let commit = null;
  let commitShort = null;
  if (source.id === "matt-pocock-skills") {
    const shaInfo = await fetchDefaultBranchSha(
      source.githubRepo,
      source.defaultBranch || "main",
    );
    if (shaInfo) {
      commit = shaInfo.sha;
      commitShort = shaInfo.short;
    }
  }
  return {
    version,
    tag: rel.tag,
    title: rel.title,
    htmlUrl: rel.htmlUrl,
    notesText: rel.notesText,
    commit,
    commitShort,
  };
}

function needsUpdate(source, latest) {
  if (FORCE) return true;
  const pinned = source.pinned || {};
  if (source.versionStrategy === "npm") {
    return isNewer(latest.version, pinned.version);
  }
  // Prefer tag compare when calendar-ish tags are used (hermes)
  if (pinned.tag && latest.tag && /v?\d{4}\.\d/.test(pinned.tag)) {
    return isNewer(latest.tag, pinned.tag);
  }
  if (pinned.version && latest.version) {
    return isNewer(latest.version, pinned.version);
  }
  if (pinned.tag && latest.tag) {
    return isNewer(latest.tag, pinned.tag);
  }
  return false;
}

async function readText(path) {
  return readFile(path, "utf8");
}

async function writeText(path, content) {
  if (DRY_RUN) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function replaceVersionStrip(html, source, latest, dateUtc) {
  const stripRe =
    /(<div class="version-strip"[^>]*>)([\s\S]*?)(<\/div>)/i;
  if (!stripRe.test(html)) {
    console.warn(`warn: no .version-strip in ${source.cheatsheetPath}`);
    return html;
  }
  const vs = source.versionStrip || {};
  const pills = [];
  if (source.id === "matt-pocock-skills") {
    const ver = latest.version || normalizeVersion(latest.tag);
    pills.push(
      `<span class="version-pill">${escapeHtml((vs.releasePillPrefix || "upstream v") + ver)}</span>`,
    );
    const short =
      latest.commitShort ||
      source.pinned?.commitShort ||
      (source.pinned?.commit || "").slice(0, 7);
    if (short) {
      const tpl = vs.commitPillTemplate || "main@{short}";
      pills.push(
        `<span class="version-pill">${escapeHtml(tpl.replace("{short}", short))}</span>`,
      );
    }
  } else if (source.id === "hermes-agent") {
    const ver = latest.version;
    pills.push(
      `<span class="version-pill">${escapeHtml((vs.releasePillPrefix || "v") + ver)}</span>`,
    );
    const tag = latest.tag.startsWith("v") ? latest.tag : `v${latest.tag}`;
    const tagPill = (vs.tagPillTemplate || "tag {tag}").replace("{tag}", tag);
    pills.push(`<span class="version-pill">${escapeHtml(tagPill)}</span>`);
  } else if (source.id === "trellis") {
    const ver = latest.version;
    pills.push(
      `<span class="version-pill">${escapeHtml((vs.releasePillPrefix || "v") + ver)}</span>`,
    );
    if (vs.secondaryPill) {
      pills.push(`<span class="version-pill">${escapeHtml(vs.secondaryPill)}</span>`);
    }
  } else {
    pills.push(
      `<span class="version-pill">${escapeHtml("v" + (latest.version || normalizeVersion(latest.tag)))}</span>`,
    );
  }
  pills.push(`<span class="version-pill">更新于 ${escapeHtml(dateUtc)}</span>`);
  const inner = `\n            ${pills.join("\n            ")}\n          `;
  return html.replace(stripRe, `$1${inner}$3`);
}

function updateFooterProvenance(html, source, latest, dateUtc) {
  // Replace version mentions in the page-footer paragraph + date "并于 YYYY-MM-DD"
  let out = html;
  const footerMatch = /(<footer class="page-footer">[\s\S]*?<p>)([\s\S]*?)(<\/p>)/i.exec(
    out,
  );
  if (!footerMatch) return out;

  let p = footerMatch[2];
  const ver = latest.version || normalizeVersion(latest.tag);
  const tag = latest.tag?.startsWith("v") ? latest.tag : `v${latest.tag || ver}`;

  if (source.id === "matt-pocock-skills") {
    p = p.replace(
      /mattpocock\/skills\/releases\/tag\/v[\w.-]+/g,
      `mattpocock/skills/releases/tag/${tag}`,
    );
    p = p.replace(/mattpocock\/skills v[\w.-]+/g, `mattpocock/skills v${ver}`);
    const short =
      latest.commitShort ||
      source.pinned?.commitShort ||
      (source.pinned?.commit || "").slice(0, 7);
    const full =
      latest.commit ||
      source.pinned?.commit ||
      short;
    if (short && full) {
      p = p.replace(
        /mattpocock\/skills\/commit\/[0-9a-f]{7,40}/gi,
        `mattpocock/skills/commit/${full}`,
      );
      p = p.replace(/main@[0-9a-f]{7,40}/gi, `main@${short}`);
    }
  } else if (source.id === "hermes-agent") {
    p = p.replace(
      /hermes-agent\/releases\/tag\/v[\w.-]+/g,
      `hermes-agent/releases/tag/${tag}`,
    );
    p = p.replace(
      /Hermes Agent v[\w.-]+ \(v[\w.-]+\)/g,
      `Hermes Agent v${ver} (${tag})`,
    );
  } else if (source.id === "trellis") {
    p = p.replace(/@mindfoldhq\/trellis v[\w.-]+/g, `@mindfoldhq/trellis v${ver}`);
  }

  p = p.replace(/并于 \d{4}-\d{2}-\d{2}/g, `并于 ${dateUtc}`);

  return (
    out.slice(0, footerMatch.index) +
    footerMatch[1] +
    p +
    footerMatch[3] +
    out.slice(footerMatch.index + footerMatch[0].length)
  );
}

function upsertChangelogSection(html, notesHtml, latest) {
  const section = `
    <section id="upstream-changelog" class="upstream-changelog" aria-labelledby="upstream-changelog-title">
      <h2 id="upstream-changelog-title">上游变更摘要</h2>
      <p class="upstream-changelog-meta">来源：<a href="${escapeHtml(latest.htmlUrl)}" target="_blank" rel="noreferrer">${escapeHtml(latest.title || latest.tag)}</a></p>
      <div class="upstream-changelog-body">
${notesHtml}
      </div>
      <p class="upstream-changelog-note">命令表仍为人工/静态整理，发布说明仅供对照，合并前请抽查关键路径。</p>
    </section>
`;

  const existing = /<section\b[^>]*\bid=["']upstream-changelog["'][^>]*>[\s\S]*?<\/section>\s*/i;
  if (existing.test(html)) {
    return html.replace(existing, `${section}\n`);
  }

  const footerIdx = html.search(/<footer\b/i);
  if (footerIdx !== -1) {
    return html.slice(0, footerIdx) + section + "\n" + html.slice(footerIdx);
  }
  const mainClose = html.search(/<\/main>/i);
  if (mainClose !== -1) {
    return html.slice(0, mainClose) + section + "\n" + html.slice(mainClose);
  }
  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + section + "\n" + html.slice(bodyClose);
  }
  return html + section;
}

function updateHomepageCard(indexHtml, source, latest) {
  const pattern = source.homepageVersionPattern;
  if (!pattern) return indexHtml;
  const ver = latest.version || normalizeVersion(latest.tag);
  // Replace "基于 vX.Y.Z" near the card for this cheatsheet
  const href = source.cheatsheetPath.replace(/\/index\.html$/, "/");
  const cardRe = new RegExp(
    `(<a class="tool-card" href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?<span class="card-description">)([\\s\\S]*?)(</span>)`,
    "i",
  );
  const m = cardRe.exec(indexHtml);
  if (!m) return indexHtml;
  let desc = m[2];
  if (/基于\s*v?[\w.-]+/.test(desc)) {
    desc = desc.replace(/基于\s*v?[\w.-]+/, `基于 v${ver}`);
  } else {
    // only update if present — leave unchanged
    return indexHtml;
  }
  return indexHtml.slice(0, m.index) + m[1] + desc + m[3] + indexHtml.slice(m.index + m[0].length);
}

function updateNotices(md, source, latest, dateUtc) {
  const heading = source.noticeHeading;
  if (!heading || !md.includes(heading)) {
    console.warn(`warn: notice heading not found: ${heading}`);
    return md;
  }
  const headings = [...md.matchAll(/^## .+$/gm)].map((m) => m.index);
  const start = md.indexOf(heading);
  let end = md.length;
  for (const idx of headings) {
    if (idx > start) {
      end = idx;
      break;
    }
  }
  let section = md.slice(start, end);
  const ver = latest.version || normalizeVersion(latest.tag);
  const tag = latest.tag?.startsWith("v") ? latest.tag : `v${latest.tag || ver}`;

  if (source.id === "matt-pocock-skills") {
    section = section.replace(/\[v[\w.-]+ release\]/g, `[${tag} release]`);
    section = section.replace(
      /\/releases\/tag\/v[\w.-]+/g,
      `/releases/tag/${tag}`,
    );
    const short =
      latest.commitShort ||
      source.pinned?.commitShort ||
      (source.pinned?.commit || "").slice(0, 7);
    const full = latest.commit || source.pinned?.commit || short;
    if (short && full) {
      section = section.replace(/\[main@[0-9a-f]{7,40}\]/gi, `[main@${short}]`);
      section = section.replace(
        /\/commit\/[0-9a-f]{7,40}/gi,
        `/commit/${full}`,
      );
    }
    section = section.replace(/\(\d{4}-\d{2}-\d{2}\)/g, `(${dateUtc})`);
  } else if (source.id === "hermes-agent") {
    section = section.replace(
      /\[v[\w.-]+ \/ v[\w.-]+ release\]/g,
      `[v${ver} / ${tag} release]`,
    );
    section = section.replace(
      /\/releases\/tag\/v[\w.-]+/g,
      `/releases/tag/${tag}`,
    );
    section = section.replace(/checked\s+\d{4}-\d{2}-\d{2}/gi, `checked ${dateUtc}`);
  } else if (source.id === "trellis") {
    section = section.replace(/\[v[\w.-]+ release\]/g, `[v${ver} release]`);
    section = section.replace(/using the \[v[\w.-]+ release\]/g, `using the [v${ver} release]`);
    section = section.replace(/checked\s+\d{4}-\d{2}-\d{2}/gi, `checked ${dateUtc}`);
  }

  return md.slice(0, start) + section + md.slice(end);
}

function buildPrMeta(changedSources, dateUtc) {
  const ids = changedSources.map((s) => s.id).join(", ");
  const branchSuggestion = `chore/sync-upstream-${dateUtc.replace(/-/g, "")}`;
  const prTitle =
    changedSources.length === 1
      ? `chore: sync ${changedSources[0].displayName} to ${changedSources[0].latest.tag || changedSources[0].latest.version}`
      : `chore: sync upstream cheatsheets (${ids})`;

  const lines = [
    "## 上游同步",
    "",
    "由 `scripts/upstream/sync.mjs` 自动检测并更新版本钉与变更摘要。**请人工审阅后再合并；工作流不会自动合并。**",
    "",
    "### 更新项",
    "",
  ];
  for (const s of changedSources) {
    lines.push(
      `- **${s.displayName}** (\`${s.id}\`): \`${s.previous}\` → \`${s.latest.tag || s.latest.version}\``,
    );
    if (s.latest.htmlUrl) lines.push(`  - 上游发布：${s.latest.htmlUrl}`);
  }
  lines.push(
    "",
    "### 审阅提醒",
    "",
    "- 命令表与示例多为 AI/静态摘要，**不会**随上游全文自动重写；请对照上游发布说明抽查关键命令与路径。",
    "- 本 PR 主要更新版本条、页脚出处、`THIRD_PARTY_NOTICES.md`、首页卡片版本，以及 `upstream-changelog` 摘要区块。",
    "",
  );
  return { branchSuggestion, prTitle, prBody: lines.join("\n") };
}

async function main() {
  const config = JSON.parse(await readText(CONFIG_PATH));
  let sources = config.sources || [];
  if (ONLY.length) {
    sources = sources.filter((s) => ONLY.includes(s.id));
  }

  const dateUtc = todayUtc();
  const results = [];
  const changedForApply = [];

  for (const source of sources) {
    process.stderr.write(`Checking ${source.id}...\n`);
    try {
      const latest = await resolveLatest(source);
      const prev =
        source.pinned?.tag ||
        (source.pinned?.version ? `v${source.pinned.version}` : "(none)");
      const changed = needsUpdate(source, latest);
      // If force but versions equal, still mark changed (for PR path testing)
      const entry = {
        id: source.id,
        displayName: source.displayName,
        previous: prev,
        latest: {
          version: latest.version,
          tag: latest.tag,
          title: latest.title,
          htmlUrl: latest.htmlUrl,
        },
        changed,
        title: latest.title,
        htmlUrl: latest.htmlUrl,
        notesPreview: (latest.notesText || "").slice(0, 280),
        _latest: latest,
        _source: source,
      };
      results.push(entry);
      if (changed) changedForApply.push(entry);
      const status = changed ? "UPDATE" : "up-to-date";
      process.stderr.write(
        `  ${source.id}: pinned ${prev} → latest ${latest.tag || latest.version} (${status})\n`,
      );
    } catch (err) {
      process.stderr.write(`  ERROR ${source.id}: ${err.message}\n`);
      results.push({
        id: source.id,
        displayName: source.displayName,
        previous: source.pinned?.tag || source.pinned?.version,
        latest: null,
        changed: false,
        title: null,
        htmlUrl: null,
        notesPreview: null,
        error: err.message,
      });
    }
  }

  if (changedForApply.length && !DRY_RUN) {
    // Load shared files once
    const indexPath = join(REPO_ROOT, "index.html");
    const noticesPath = join(REPO_ROOT, "THIRD_PARTY_NOTICES.md");
    let indexHtml = await readText(indexPath);
    let noticesMd = await readText(noticesPath);

    for (const entry of changedForApply) {
      const source = entry._source;
      const latest = entry._latest;
      const sheetPath = join(REPO_ROOT, source.cheatsheetPath);
      let html = await readText(sheetPath);

      html = replaceVersionStrip(html, source, latest, dateUtc);
      html = updateFooterProvenance(html, source, latest, dateUtc);
      const notesHtml = notesToSafeHtml(latest.notesText);
      html = upsertChangelogSection(html, notesHtml, latest);
      await writeText(sheetPath, html);

      indexHtml = updateHomepageCard(indexHtml, source, latest);
      noticesMd = updateNotices(noticesMd, source, latest, dateUtc);

      // Update pin in config object
      source.pinned = {
        ...source.pinned,
        version: latest.version,
        tag: latest.tag,
        checkedAtUtc: dateUtc,
      };
      if (latest.commit) {
        source.pinned.commit = latest.commit;
        source.pinned.commitShort = latest.commitShort;
      } else if (source.id === "matt-pocock-skills" && source.pinned.commit) {
        // keep old commit if we couldn't fetch SHA
      }
    }

    await writeText(indexPath, indexHtml);
    await writeText(noticesPath, noticesMd);
    config.updatedAtUtc = dateUtc;
    await writeText(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  } else if (changedForApply.length && DRY_RUN) {
    notice(
      `Dry-run: would update ${changedForApply.map((e) => e.id).join(", ")} (no writes)`,
    );
  } else {
    notice("Upstream pins are up to date; nothing to change.");
  }

  const meta = buildPrMeta(
    changedForApply.map((e) => ({
      id: e.id,
      displayName: e.displayName,
      previous: e.previous,
      latest: e._latest || e.latest,
    })),
    dateUtc,
  );

  const report = {
    updated: changedForApply.length > 0,
    dryRun: DRY_RUN,
    force: FORCE,
    checkedAtUtc: dateUtc,
    sources: results.map((r) => ({
      id: r.id,
      previous: r.previous,
      latest: r.latest
        ? r.latest.tag || r.latest.version
        : null,
      latestMeta: r.latest,
      changed: r.changed,
      title: r.title,
      htmlUrl: r.htmlUrl,
      notesPreview: r.notesPreview,
      error: r.error || undefined,
    })),
    branchSuggestion: meta.branchSuggestion,
    prTitle: meta.prTitle,
    prBody: meta.prBody,
  };

  // Always write report (even dry-run) — path overridable via SYNC_REPORT_PATH
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (report.updated) {
    notice(
      `Upstream sync: ${changedForApply.length} source(s) need update` +
        (DRY_RUN ? " (dry-run)" : ""),
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

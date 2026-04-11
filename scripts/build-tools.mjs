#!/usr/bin/env node
// Walks *.html in repo root (excluding index.html), reads git history for each,
// and patches two things:
//
//   1. Each tool file's <!-- TOOL_META_START -->..<!-- TOOL_META_END --> region
//      with a "source · Added/Updated <date>" line. The source link is derived
//      from `git remote get-url origin` so it stays correct across forks.
//
//   2. index.html's <!-- TOOLS_LIST_START -->..<!-- TOOLS_LIST_END --> region
//      with a list of tools sorted by last-updated date desc.
//
// Workflow:
//   1. Edit / add tool HTML file(s), commit those changes.
//   2. Run: node scripts/build-tools.mjs
//   3. Commit the patched index.html and any tool files whose TOOL_META
//      regions were updated.
//
// Notes:
//   - Dates are git author dates (%aI). `created` is the first --diff-filter=A
//     commit for the file; `updated` is the most recent commit touching it.
//   - A file with no git history yet (never committed) gets no date — it
//     will appear without a meta line until you commit it at least once.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const INDEX = join(ROOT, 'index.html');

// --- git helpers --------------------------------------------------------

function git(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function getRepoUrl() {
  const remote = git('git remote get-url origin');
  if (!remote) throw new Error('No git remote named "origin" — add one or adapt this script.');
  const m = remote.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) throw new Error(`Could not parse GitHub remote: ${remote}`);
  return `https://github.com/${m[1]}/${m[2]}`;
}

function gitCreated(file) {
  // First commit that ADDED this file (survives renames via --follow).
  const out = git(`git log --follow --diff-filter=A --format=%aI --reverse -- "${file}"`);
  return out.split('\n')[0] || null;
}

function gitUpdated(file) {
  return git(`git log -1 --format=%aI -- "${file}"`) || null;
}

// --- HTML extraction ----------------------------------------------------

function extractTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractDescription(html) {
  const meta = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  if (meta) return meta[1].trim();
  const lead = html.match(/<p class="lead">([\s\S]*?)<\/p>/);
  if (lead) return stripTags(lead[1]).trim();
  return '';
}

function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- formatting ---------------------------------------------------------

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function metaLabel(tool) {
  if (tool.updated && tool.created && tool.updated !== tool.created) {
    return `Updated ${formatDate(tool.updated)}`;
  }
  if (tool.created) return `Added ${formatDate(tool.created)}`;
  if (tool.updated) return `Updated ${formatDate(tool.updated)}`;
  return '';
}

// --- marker replacement -------------------------------------------------

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceMarker(text, start, end, inner) {
  const re = new RegExp(`(${escapeRegex(start)})[\\s\\S]*?(${escapeRegex(end)})`);
  return text.replace(re, `$1${inner}$2`);
}

// --- main ---------------------------------------------------------------

async function main() {
  const repoUrl = getRepoUrl();

  const entries = await readdir(ROOT, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.html') && e.name !== 'index.html')
    .map((e) => e.name)
    .sort();

  const tools = [];
  for (const file of files) {
    const path = join(ROOT, file);
    const html = await readFile(path, 'utf8');
    const tool = {
      file,
      slug: file.replace(/\.html$/, ''),
      title: extractTitle(html),
      description: extractDescription(html),
      created: gitCreated(file),
      updated: gitUpdated(file),
    };
    tools.push(tool);

    // Patch the tool file's own TOOL_META region.
    const srcUrl = `${repoUrl}/blob/main/${file}`;
    const label = metaLabel(tool);
    const dateIso = tool.updated || tool.created || '';
    const metaInner =
      `<a href="${escapeHtml(srcUrl)}" target="_blank" rel="noopener">source</a>` +
      (label
        ? ` &middot; <time datetime="${escapeHtml(dateIso)}">${escapeHtml(label)}</time>`
        : '');

    if (html.includes('<!-- TOOL_META_START -->') && html.includes('<!-- TOOL_META_END -->')) {
      const patched = replaceMarker(
        html,
        '<!-- TOOL_META_START -->',
        '<!-- TOOL_META_END -->',
        metaInner
      );
      if (patched !== html) {
        await writeFile(path, patched);
        console.log(`patched ${file}`);
      }
    } else {
      console.warn(`WARN: ${file} has no TOOL_META markers; skipping per-tool patch`);
    }
  }

  // Sort by updated desc, fall back to created desc.
  tools.sort((a, b) => {
    const ad = Date.parse(a.updated || a.created || 0) || 0;
    const bd = Date.parse(b.updated || b.created || 0) || 0;
    return bd - ad;
  });

  // Build the list HTML for index.html.
  const listHtml = tools
    .map((t) => {
      const label = metaLabel(t);
      const dateIso = t.updated || t.created || '';
      const metaLine = label
        ? `\n      <p class="meta"><time datetime="${escapeHtml(dateIso)}">${escapeHtml(label)}</time></p>`
        : '';
      return `    <li>
      <h2><a href="${escapeHtml(t.file)}">${escapeHtml(t.title || t.slug)}</a></h2>
      <p>${escapeHtml(t.description)}</p>${metaLine}
    </li>`;
    })
    .join('\n');

  const indexHtml = await readFile(INDEX, 'utf8');
  const patchedIndex = replaceMarker(
    indexHtml,
    '<!-- TOOLS_LIST_START -->',
    '<!-- TOOLS_LIST_END -->',
    `\n${listHtml}\n    `
  );
  if (patchedIndex === indexHtml) {
    throw new Error('index.html is missing <!-- TOOLS_LIST_START/END --> markers');
  }
  if (patchedIndex !== indexHtml) {
    await writeFile(INDEX, patchedIndex);
    console.log(`patched index.html`);
  }

  console.log(`\n${tools.length} tool(s):`);
  for (const t of tools) {
    console.log(`  ${t.slug}  —  ${metaLabel(t) || 'no date'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

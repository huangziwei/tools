# CLAUDE.md

Single-file client-side web tools at https://huangziwei.github.io/tools/.
Style reference: https://tools.simonwillison.net. One `.html` per tool at
repo root, everything runs in the browser.

## Invariants

- One HTML file per tool. No bundler. Opening the file in a browser works.
- No user data leaves the device. CDN deps are fine; user input stays local.
- Vanilla JS, inline `<script>` at end of body. No frameworks.
- Dark/light via `prefers-color-scheme`. Reuse CSS variables from any
  existing tool file for palette, typography, and max-width.

## Page structure

Every tool page follows this layout:

```html
<div class="page-header">
  <h1>Tool Name</h1>
  <!-- SOURCE_LINK_START --><!-- SOURCE_LINK_END -->
</div>
<p class="lead">One-line description.</p>
<!-- ... tool UI ... -->
<footer>
  All data stays on your device.<br>
  <!-- TOOL_META_START --><!-- TOOL_META_END -->
</footer>
```

- `.page-header` is a flex row: h1 left, GitHub icon right.
- `.lead` is the tool description. Do **not** add "Everything runs in
  your browser" — the footer already conveys that.
- Footer line 1: privacy note. Line 2: date (+ optional "built with"
  credits after TOOL_META region). Links stay in header icon.

## Contract with the build automation

A new tool at `<slug>.html` (repo root) must contain:

- `<title>Tool Name</title>` — becomes the index entry title
- `<p class="lead">One-line description.</p>` — becomes the index
  description
- `<!-- SOURCE_LINK_START --><!-- SOURCE_LINK_END -->` in the page
  header — filled with a GitHub icon linking to the file's source
- `<!-- TOOL_META_START --><!-- TOOL_META_END -->` in the footer —
  filled with a git-derived date (YYYY/MM/DD HH:MM in author timezone)

After commit + push, `.github/workflows/build-tools.yml` runs the script,
which regenerates `TOOLS_LIST_START/END` in `index.html` and every tool's
`SOURCE_LINK_*` and `TOOL_META_*` regions. Filesystem is the registry — no
manifest.

## Never

- **Hand-edit marker regions** (`TOOLS_LIST_*`, `TOOL_META_*`,
  `SOURCE_LINK_*`). Overwritten on every CI run.
- **Hand-edit tool dates.** Git is the source of truth — change the commit.
- **Hardcode `huangziwei/tools` URLs.** The script derives them from
  `git remote get-url origin`.
- **Load WASM-heavy libraries from `esm.sh`.** It injects a Node `process`
  polyfill that trips Emscripten's env detection; mupdf hits `createRequire`
  and dies with `[unenv] module.require is not implemented yet`. Use
  `https://cdn.jsdelivr.net/npm/<pkg>@<ver>/<path>` instead.
- **Ship without testing the golden path in a real browser.** Node-side
  tests don't catch WASM init failures, CORS, or env-detection bugs.

## License

AGPL-3.0-or-later, repo-wide via root `LICENSE`. No per-file headers
needed. AGPL-compatible deps are fine (MIT, Apache, BSD, GPL, AGPL).

## Local preview

```bash
python3 -m http.server 8000        # file:// breaks CORS for CDN imports
node scripts/build-tools.mjs       # optional: preview CI's regeneration
```

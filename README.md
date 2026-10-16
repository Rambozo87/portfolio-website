# portfolio-website

Minimal Astro static site for Triston Wilson's portfolio.

## Local development

Requires Node.js 18.17 or newer. From this directory:

```sh
npm install
npm run dev
```

Build the static output with `npm run build`, then optionally inspect it with `npm run preview`.

Projects are discovered at build time from `../portfolio/projects/*/project.md`. Only validated Markdown-referenced images and PDFs are published. Approved source files are separately discovered under project `src/`, `include/`, `examples/`, and `tests/` directories and rendered as static Shiki-highlighted pages with line numbers. Project code is displayed only; it is never executed.

Each project requires non-empty `title` and `description` frontmatter. Optional fields are `tags` (string array), `status` (`planned`, `in-progress`, `complete`, or `archived`), `year` (four-digit integer), `featured` (boolean), and `order` (non-negative integer). Project directory names must be lowercase hyphen slugs. Projects are currently sorted alphabetically; sorting is centralized for future changes.

Set `PORTFOLIO_PROJECTS_DIR` to override the default content path when building in another workspace.

The confirmed GitHub Pages repository base is configured as `/portfolio-website`; generated internal links use Astro's base URL so local builds and repository-subpath hosting share the same route structure. Deployment automation is intentionally not configured.

## Source browser policy

Supported source extensions are Rust (`.rs`), C/C++ (`.c`, `.cc`, `.cpp`, `.cxx`, `.h`, `.hh`, `.hpp`), SystemVerilog (`.sv`, `.svh`), Python (`.py`), JSON (`.json`), TOML (`.toml`), and Markdown (`.md`). Files must be valid UTF-8, valid JSON where applicable, contain no NUL bytes, and remain below 256 KiB. Hidden paths, symlinks, path traversal, unsupported files, and arbitrary project files are not published. Original GitHub source links are generated for the known `Rambozo87/portfolio` repository.

Demonstration projects can be removed later by deleting their directories from `../portfolio/projects/`; the website discovers routes automatically and requires no route-file changes.

## GitHub Pages deployment

`.github/workflows/deploy.yml` owns the build and deployment. On pushes to `main`, manual `workflow_dispatch`, and an hourly scheduled run, it checks out the two repositories as sibling directories:

```text
workspace/
  portfolio-website/
  portfolio/
```

The workflow runs `npm ci`, `npm test`, and `npm run build` in `portfolio-website`, then uploads only `portfolio-website/dist/` to GitHub Pages. The portfolio checkout is treated as untrusted data: its scripts are never installed or run. A failed test or build stops the job before an artifact can be deployed. Actions are pinned to commit SHAs, and permissions are limited to read access plus the Pages/OIDC permissions required by the official deployment actions.

Scheduled GitHub Actions runs are best-effort and may be delayed; they are not guaranteed to run exactly at `:17` every hour. Use the Actions tab's **Run workflow** button for an immediate rebuild. Inspect the failed job's step log and uploaded annotations when diagnosing a failed build; deployment does not proceed when the build job fails.

Before the first deployment, in the GitHub web interface:

1. Ensure both repositories are accessible to the workflow. A public `portfolio` repository requires no token; a private content repository requires an approved access design that is not implemented here.
2. In `portfolio-website`, open **Settings → Pages** and select **GitHub Actions** as the source.
3. Confirm the repository Actions settings permit workflows and that the `github-pages` environment is available.
4. Run the workflow manually once, then inspect the deployment URL in the workflow summary.

The current base path is `/portfolio-website`, matching the repository name and confirmed `Rambozo87` remote. For a repository rename, update `base` and `site` in `astro.config.mjs` together with the Pages URL. For a custom domain, follow GitHub's Pages custom-domain setup, change `site`, remove or update `base` as appropriate, and review all generated links before enabling the domain. No custom-domain file or Pages setting is configured automatically.

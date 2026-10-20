# Murali’s Vault

A personal journal built with Hugo Extended **0.167.0** and Blowfish **v3.9.0**. The custom journal layer uses a white and navy palette, serif headings, and contextual section navigation. Theme source is a pinned Git submodule; customizations live outside it.

Production address: https://muralisvault.in/

## Local preview

Install Hugo Extended 0.167.0 and Python 3.11 or newer, then:

```sh
git clone --recurse-submodules git@github.com:mmcode-hub/muralisvault.git
cd muralisvault
hugo server
```

Open the address printed by Hugo. To see unpublished drafts, use `hugo server --buildDrafts`. The example travel entry is deliberately unpublished. Never use `--buildDrafts` for a production build.

## Write an entry

```sh
hugo new content --kind entry travel/my-first-journey/index.md
```

Use `profession/`, `travel/`, `my-thoughts/`, or one of `temple-architecture/temple-stories/`, `temple-architecture/places/`, and `temple-architecture/architectural-elements/` as the parent path. The page bundle keeps an entry and its photos together.

Edit the generated Markdown, replacing the title, summary, date, and body. New entries default to `draft: true`. Preview the entry, then set `draft: false` to publish. Future-dated entries are also excluded until that date; deployment is triggered by changes to main, not by a daily schedule.

For a photo, place a JPEG, PNG, or WebP alongside `index.md`, set `image: "photo.jpg"`, and add meaningful `imageAlt`. An optional `imageCaption` appears below the article image. A `feature*` image is used automatically when no image field is supplied. Resize large original photos before committing. Entries work without any image.

The About biography can be added as Markdown in `content/about/_index.md`. Set `showEmptyState: false` there once a biography has been added. Landing-page summaries and titles are also edited in each section’s `_index.md` file. Navigation is generated from published content; set `weight` to control its order. The top-level section order is already configured.

## Blog Studio (local editor)

Blog Studio is a local-only writing interface for new and existing journal entries. It writes the same Hugo page bundles used by this repository, previews them with Hugo, runs the production checks, and can create and merge a GitHub pull request through the locally authenticated GitHub CLI. Use the Write tab for rich text and its formatting toolbar, Markdown for Hugo embeds, and Preview after saving to inspect the rendered page. Focus mode gives the editor more room; the footer shows word count and estimated reading time. Press Ctrl/⌘ + S to save. The Studio warns before leaving an entry with unsaved changes.

Run the Studio from the repository root:

```sh
npm run blog-studio
```

The first launch installs the Studio's dependencies and downloads a checksum-verified Hugo Extended 0.167.0 into the Studio's private runtime folder; it does not use or change your system Hugo installation. Open `http://127.0.0.1:4174`, then select **Connect GitHub** in the Studio when you are ready to publish. It starts GitHub CLI's browser/device authorization flow and keeps the credential in GitHub CLI's credential store, never in the browser. The Hugo preview runs at `http://127.0.0.1:1313`. It is deliberately bound to localhost.

## Check and publish

```sh
hugo --gc --minify --panicOnWarning
python3 scripts/check_site.py public
```

For a clean build after deleting or renaming content, add `--cleanDestinationDir` (this replaces the generated `public/` output only). Do not check generated files into Git.

Open a pull request. GitHub Actions builds and checks the production output on pull requests. After review and merge to `main`, the workflow builds again and deploys to GitHub Pages. In repository **Settings → Pages**, the build source must be **GitHub Actions** and the custom domain must be **muralisvault.in**. Keep Hugo's `baseURL` aligned with that domain so assets and navigation resolve from the site root. The `github-pages` environment is used for deployments. No secrets are required.

The output check verifies internal links, assets, anchors, required sections, search URLs, XML feeds, and draft exclusion. Before changing layouts, also review the homepage, a section, an article with and without a photo, and the 404 page at desktop and mobile widths. Check keyboard navigation and search.

## Updating dependencies

Keep the theme pinned; never edit `themes/blowfish` directly:

```sh
git -C themes/blowfish fetch --tags
git -C themes/blowfish checkout <reviewed-release-tag>
git add themes/blowfish
```

Update the Hugo version in `.github/workflows/site.yml` and this README together. Run the production checks and browser review before opening a dependency-update PR. The workflow verifies the Hugo release archive against its published checksum.

Custom templates live in `layouts/`; the theme continues to provide metadata, search, feeds and its underlying assets. Journal styles are in `assets/css/custom.css`. `assets/js/appearance.js` intentionally locks the site to the light palette, including when the browser has stored another Blowfish site's appearance preference.

## Initial boundaries

English only; no analytics, comments, contact form, or CMS. No biography or travel claims are invented. All example content remains in drafts. This repository is exempt from Redmine and dev-playbook by owner instruction.

The local search script is based on Blowfish v3.9.0 and adds paste/input handling, replay of the first query after index loading, and a no-results message. Compare it with the upstream script when upgrading the theme.

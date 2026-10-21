# Blog Studio

Write and publish journal entries from a local browser window.

## Run

You need Git, npm, and Node.js 20.19+ in the v20 series, or Node.js 22.12+. The bundled Hugo download currently supports Linux x86-64. Install the GitHub CLI (`gh`) if you want to create or merge pull requests.

From the repository root, run one command:

```sh
npm run blog-studio
```

Open **http://127.0.0.1:4174**. The first run installs the editor dependencies and downloads Hugo Extended 0.167.0 for the Studio. It leaves your system Hugo installation alone. Press Ctrl+C in the terminal to stop the Studio.

## Write and publish

1. Select **New entry** or open an entry from the library.
2. Write in **Write**; use **Markdown** for Hugo embeds. Add a title, summary, and any images.
3. Select **Preview page** to save current changes and open the rendered page in a new browser tab. Drafts appear there too.
4. Select **Verify** to check the production build.
5. To publish, select **Connect GitHub** and complete the browser/device sign-in. Then select **Create PR**. Review the pull request before selecting **Merge PR**.

Entries are saved as Hugo page bundles under `content/`. Entries marked **Keep as draft** remain unpublished after merging. Use Ctrl/⌘+S to save while editing.

To remove an entry, open it and select **Delete entry**. It moves to **Local trash**, where you can restore it. If the entry was already tracked by Git, use **Verify** and **Create removal PR** to remove it from the published site; the local trash copy is cleared after the PR is merged.

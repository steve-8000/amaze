# amaze-design

**Run Claude Design locally in Amaze, Codex, Claude Code, Cursor, or any file‑capable coding agent.**

[Changelog](CHANGELOG.md)

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg) ![Harness](https://img.shields.io/badge/Amaze%20%C2%B7%20Codex%20%C2%B7%20Claude%20Code-supported-1f6feb)

`amaze-design` packages **Claude Design** — the design engine behind [claude.ai/design](https://claude.ai/design) — as a portable **Agent Skill**. Drop it into a local agent and you get most of what the website does, right inside your editor: polished UI mockups, interactive prototypes, wireframes, landing pages, dashboards, mobile apps, and slide decks — all produced as self‑contained HTML.

No website, no separate subscription, no upload step. The agent already on your machine does the work, and every artifact stays in your repo.

---

## Screenshots

The same Reader Mac App prompt was used in Cursor, Codex, Claude, and Claude Design.

| Cursor | Codex | Claude | Claude Design |
|---|---|---|---|
| <img src="assets/screenshots/cursor-reader-mac-app.webp" alt="Cursor running amaze-design" width="240"> | <img src="assets/screenshots/codex-reader-mac-app.webp" alt="Codex running amaze-design" width="240"> | <img src="assets/screenshots/claude-reader-mac-app.webp" alt="Claude running amaze-design" width="240"> | <img src="assets/screenshots/claude-design-reader-mac-app.webp" alt="Claude Design running the same Reader Mac App prompt" width="240"> |

<details>
<summary>Prompt used for all screenshots</summary>

```markdown
Build a Reader Mac app that helps me read and save articles better. All data is stored locally.

## Information collection

1. Manual adding
Support manually adding different types of information:
- URL: enter a URL and automatically fetch content and images
- Attachments: upload PDFs, videos, and images
- Markdown editing: like publishing a blog post, enter the title, body, and cover image
- Other

2. Automatic subscriptions
- RSS feeds
- Social media accounts: X, Weibo, YouTube
- Other

## Editing and organization

1. Tags
Every item can have tags.

2. Categories and folders
Create tree-structured folders and place content in different categories.

3. Favorites
Users can click to favorite an item.

4. Editing
Every item can be edited with a built-in Markdown editor.

## AI assistance

1. Automatic translation
Support translation across different languages.

2. Summaries and abstracts
Generate summaries for captured content.

3. Derivative creation
Create new work based on one or more pieces of content.

4. Integrated AI Chat
Use AI Chat to call AI Agents that help process content.
```

</details>

---

## Why run it locally

- **Free yourself from the website.** You get the vast majority of `claude.ai/design`'s capabilities without ever leaving your editor — same methodology, same craft standards, same output format.
- **Best with Opus 4.8.** The skill is a long, demanding design brief; the stronger the model, the better the result. Pair it with **Claude Opus 4.8** for the best output, and it still works well on other capable models.
- **Iterate by pointing, not describing.** Because the deliverable is plain HTML served on `localhost`, you can lean on your agent's built‑in browser preview and element‑annotation tools (Cursor Browser / DevTools, Claude Preview, or Codex Browser). Point at a button in the live preview, say what you want changed, and the agent edits the underlying source — a tight, visual second‑pass editing loop that's hard to get on a website.
- **Everything is yours.** Output lands in `designs/<project>/` as self‑contained HTML you can version, fork, export, or ship.

---

## What it can make

The skill drives a full design process — clarifying questions → gathering design context → producing one or more HTML deliverables → previewing and verifying. It ships a deep bench of **built‑in skills** and a set of ready‑made component scaffolds.

| Area | Built‑in skills |
|---|---|
| **Core design** | Hi‑fi design · Interactive prototype · Wireframe · Frontend aesthetic direction |
| **Decks** | Make a deck · Speaker notes |
| **Mobile & motion** | Mobile prototype · Animated video · Sound effects |
| **Design systems** | Create design system · Use design system · Design system preview · Design Components (`.dc.html`) · Make tweakable |
| **Import sources** | Figma `.fig` (offline decode) · GitHub repo · Existing HTML/CSS |
| **Export & handoff** | Standalone HTML · PDF · PPTX (editable) · PPTX (screenshots) · Send to Figma · Send to Canva · Handoff to Claude Code |
| **AI assets & integration** | Gemini image generation · Call Claude from prototypes · Read PDF |

**Starter components** (in [`starter-components/`](skills/amaze-design/starter-components/)) save the agent from hand‑rolling the basics: iOS / Android / macOS / browser frames, a pan‑zoom design canvas, a slide‑deck stage, a timeline animation engine, a tweaks panel, and a fillable image slot.

---

## How it works

The skill is plain Markdown plus a few JSX/JS scaffolds — no build step, no runtime.

```
skills/amaze-design/
├── SKILL.md              # Entry point — orchestrates the whole flow
├── system-prompt.md      # The design methodology & craft standards (source of truth)
├── references/
│   ├── claude.md         # Tool map for Claude Code
│   ├── cursor.md         # Tool map for Cursor
│   └── codex.md          # Tool map for Codex Agent
├── built-in-skills/      # Specialized prompts (decks, mobile, import, export, …)
└── starter-components/   # Device frames, deck stage, canvas, animation engine, …
```

When you ask for a design, the agent reads `SKILL.md`, loads the core methodology from `system-prompt.md`, detects whether it's running in Cursor, Claude Code, Codex Agent, or a generic file‑capable harness, and reads the matching reference doc when one exists. It then pulls in only the built‑in skill(s) the task needs. The split keeps craft rules harness‑independent while each environment resolves its own tools for *asking questions*, *previewing*, *screenshotting*, and *verifying*.

---

## Quick start

### Prerequisites

- A local agent — **Amaze**, **[Codex](https://developers.openai.com/codex/)**, **[Claude Code](https://claude.com/claude-code)**, **[Cursor](https://cursor.com)**, or any file-capable coding agent. Amaze uses the Codex-style `functions.*` tool mapping in `references/codex.md`.
- A strong design-capable model selected for best results.
- **Node.js** (to run the `npx` installer below). **Python 3** is also handy for the local preview server.

### Install

**Amaze project install.** Copy the skill into this repo's Amaze skill directory:

```bash
mkdir -p .amaze/skills
cp -R skills/amaze-design .amaze/skills/amaze-design
```

**Portable install — the `skills` CLI.** [`npx skills`](https://github.com/vercel-labs/skills) reads this repo, finds `skills/amaze-design/`, and drops it into the right folder for whatever agent it detects:

```bash
# Install into the current project (auto‑detects your agent)
npx skills add steipete/amaze-design

# …or install globally, for every project
npx skills add steipete/amaze-design -g

# Target a specific agent explicitly
npx skills add steipete/amaze-design --agent claude-code
npx skills add steipete/amaze-design --agent cursor
npx skills add steipete/amaze-design --agent codex

# Just list what's in the repo first
npx skills add steipete/amaze-design --list
```

It installs to `.claude/skills/` for Claude Code and `.agents/skills/` for Cursor/Codex-style agents (add `-g` for the `~/`‑level user install). For Amaze, keep the checked-in copy under `.amaze/skills/amaze-design/`.

**Alternative — hand the repo URL to your agent.** Don't want to install anything? Paste the URL into chat and let the agent fetch the skill itself:

> Read https://github.com/steipete/amaze-design and follow its `skills/amaze-design/SKILL.md` to design a settings screen for a meditation app.

The agent clones or fetches the repo, loads `SKILL.md`, and proceeds — perfect for a one‑off.

### Use it

Once the skill is installed (or fetched), just describe a design task in plain language — it auto‑activates from its description:

> Design 3 hi‑fi variations of a settings screen for a meditation app.

In Amaze/Codex, mention `amaze-design` when skills are available. In Claude Code you can also trigger it explicitly with `/amaze-design`. The agent asks a few clarifying questions, builds the HTML under `designs/`, and previews it over `localhost`. **Point at any element in the live preview and say what to change** — the agent edits the underlying source for a fast, visual second pass.

### Preview server

Deliverables are previewed over HTTP (multi‑file prototypes won't load from `file://`). The agent normally starts this for you; to run it by hand:

```bash
python3 -m http.server 4311 --directory designs
# then open http://localhost:4311/<project>/<file>.html
```

---

## Design systems

Beyond one‑off mockups, the skill can hold a whole project to a **design system** — a versioned bundle of a brand's tokens, fonts, components, and full UI kits. Systems live next to your projects under `designs/`: author one with the *Create design system* built‑in skill, drop in a pre‑built one, or import one from a Figma `.fig` file (see the next section). Once a system exists, two flows let any project consume it.

### Import an existing design system

When you start a design, the agent asks **where to save it** and **which design system(s) to use** — it discovers every system under `designs/` and lists them, so you can pick none (free design), one, or several. Name one up front and it skips the menu:

> Design a settings screen using the **Fluent 2** design system.

For each system you choose, the agent syncs a **self‑contained, version‑pinned copy** into your project at `_ds/<slug>/`, wires its CSS and component bundle into the page, and records the binding in the project's `_d_meta.json`. That local copy is what keeps the project portable and reproducible — nothing reaches outside the folder, and re‑running the import is how you pull updates later. Choose several systems and one becomes **primary** — it owns the overall look and wins any token collision, while the others lend specific components.

### Use an imported design system

Once a system is bound it acts as a **binding visual contract**, not a loose suggestion: every screen is built from the system's real tokens, type, spacing, and components, and the agent won't invent off‑system colors or styles. If the system ships **starting points** — ready‑made screens or components — you can seed a new design from one instead of starting blank.

The binding travels with the project. Reopen it later and the agent reads `_d_meta.json`, reloads the system, and keeps designing in‑style — no need to re‑pick. From there you can **refresh** a system to pull updates, **add** another, **swap** which one is primary, or **remove** one entirely.

---

## Import design sources

Real context beats description. Three built‑in import skills turn material you already have into design ground truth the agent works from directly:

- **Figma `.fig` files — decoded fully offline.** Export any Figma file as `.fig` (or grab a community kit), point the agent at it, and a vendored decoder reads it right on your machine — no Figma account, API token, or MCP server. The agent inventories pages, components, and variables, confirms scope with you, then either cherry‑picks components as React code or emits the whole kit as a design system: components regrouped semantically, curated token CSS, real SVG/PNG assets extracted from the file (copied, never redrawn), guideline cards, and a brand‑guide README.
- **GitHub repos.** Hand it a repo URL as a design source. The agent browses the tree with `gh api` before cloning anything, sparse‑checkouts only the paths it needs into a scratch dir outside your project, and records the repo URL as provenance.
- **Existing HTML/CSS.** Saved pages or a local codebase work as a design reference: the agent reads the real stylesheets instead of squinting at screenshots, lifts exact values (colors, type, spacing, radii, shadows, interaction states) into your project's own custom properties, and copies referenced assets out.

Anything imported as a design system compiles into a single self‑contained, interactive `preview.html`. This is the community **Chakra UI Figma Kit** `.fig` after one import conversation — 28 components in semantic groups, 400+ curated tokens, guideline cards, and a self‑authored showcase, all browsable in one file:

<img src="assets/screenshots/figma-import-chakra-preview.webp" alt="preview.html of a design system imported from the Chakra UI Figma Kit .fig" width="720">

---

## Example prompts

- *"Design 3 hi‑fi variations of a pricing page using the brand in this screenshot."*
- *"Prototype a working onboarding flow — real state, transitions, form validation."*
- *"Make a 10‑slide deck from this PRD for an engineering all‑hands."*
- *"Wireframe a few layout ideas for a mobile expense‑tracker home screen."*
- *"Recreate the composer UI from this codebase, then export it as standalone HTML."*
- *"Turn this UI kit `.fig` into a design system, then build a dashboard with it."*
- *"Build a dashboard using our design system, starting from its analytics screen."*

For best results, **give it design context** — a screenshot, a UI kit, a Figma `.fig` export, or a codebase. Starting from real context is the single biggest lever on quality; the skill will ask for it if you don't provide it.

---

## Credits & license

This project repackages **Claude Design**, the design skill by **Anthropic** that powers [claude.ai/design](https://claude.ai/design), so it can run on local agents. It is an independent, community effort and is not affiliated with or endorsed by Anthropic.

Repackaged and maintained by **Jim Liu**. Released under the [MIT License](LICENSE).

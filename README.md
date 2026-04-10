# Sakha

Sakha is your personal AI agent platform.
It is built to be usable on Android and different laptops through a hosted web app or PWA, while still being able to perform guarded local actions when it is running on your laptop.

## What changed

- renamed the app from Operator One to Sakha
- added automatic provider routing so Sakha can choose the most suitable configured source for a task
- added optional Google Drive app-data storage so memory and tasks can survive reinstalls and follow you across devices
- added GitHub CI so the codebase is ready to live in a repository cleanly

## What Sakha can do today

- route prompts across Hugging Face, OpenAI API, OpenRouter, and Ollama
- keep memory and task history
- use guarded local tools for file work and a narrow command allowlist when hosted on your laptop
- run as an installable PWA on Android and desktop browsers

## Best storage choice for your case

For your personal app, hidden Google Drive app-data storage is a strong free option because:

- it keeps data out of the device so reinstalling does not wipe memory
- it uses very little space because conversations and task state are plain JSON
- it can be shared across devices as long as the same hosted Sakha instance is using the same Google credentials

GitHub is good for source code, version control, issues, and releases.
GitHub is not the best place for live conversation memory.

## Important truth about capability

Sakha can become very capable, but no single setup will automatically equal every best-in-class system at once.
The right approach is:

- route by task
- keep memory and preferences
- add strong tools
- add safe local execution
- add curated upgrades over time

That is what this codebase is now set up to do.

## Source code on GitHub

Yes. This project is ready for GitHub.
A CI workflow is included at `.github/workflows/ci.yml`.

Typical flow:

```bash
git init
git add .
git commit -m "Initial Sakha build"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## Environment setup

Copy `.env.example` to `.env.local` and configure what you want.

```env
HUGGINGFACE_API_KEY=
HUGGINGFACE_MODEL=
OPENAI_API_KEY=
OPENAI_MODEL=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_MODEL=llama3.2
STORAGE_BACKEND=local
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_FILE_NAME=sakha-state.json
```

Use `STORAGE_BACKEND=google-drive` to switch to Google Drive sync mode.

## How Google Drive storage works here

When Google Drive storage is enabled, Sakha stores its state in a hidden `appDataFolder` file in your Google Drive account.
That means:

- no visible clutter in normal Drive folders
- shared memory across reinstallations and devices
- small storage footprint

This is currently designed for a personal single-user deployment.

## Android and different laptops

Recommended setup:

1. host Sakha on a cloud service like Vercel
2. use Google Drive storage for shared memory
3. install the PWA on Android and any laptop browser
4. run a second Sakha instance locally on your main laptop when you want local file or shell actions

That gives you both:

- shared cloud memory everywhere
- local-machine execution only where it is safe and actually possible

## Local machine capability

A web app on Android cannot directly act on your laptop unless your laptop hosts the execution layer.
So the correct model is:

- hosted Sakha for universal access and synced memory
- laptop-hosted Sakha for local actions on that laptop

This code already supports that split conceptually.

## Self-learning and upgrades

Safe self-improvement means:

- saving useful memory automatically
- improving provider routing over time
- adding new modules deliberately
- learning from trusted web tools and connected systems with controls

Unsafe autonomous self-rewriting is not enabled, because that would make the agent less trustworthy, not more.

## Files to know

- `src/app/page.tsx`: main entry
- `src/components/chat-shell.tsx`: Sakha dashboard UI
- `src/lib/runner.ts`: provider routing + agent loop
- `src/lib/providers.ts`: provider selection heuristics
- `src/lib/storage.ts`: local and Google Drive-backed state storage
- `src/lib/tools.ts`: guarded local tools
- `.github/workflows/ci.yml`: GitHub verification

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Recommended next upgrades

- browser automation for web tasks
- approval gates before writes and commands
- encrypted secrets and user auth
- a background job queue for recurring tasks
- richer memory and retrieval instead of simple JSON history
- a small local companion service for stronger laptop control

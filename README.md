# APP Analyzer

Local desktop analyzer for authorized Android apps, Windows/macOS/Linux packages, websites, source trees, Python packages, Docker/containers, and archives. It wraps [REA](https://github.com/morluto/rea) (`rea-agents`) on this machine, keeps evidence on disk, and never invents files.

This repository is the source for [Shlok0095/APP-anlyser](https://github.com/Shlok0095/APP-anlyser).

## What it is

- One Electron window: **Analyze**, **Jobs**, **Report**, **Settings**.
- REA runs behind the scenes (`rea analyze` plus follow-up inspections).
- Each job writes an **evidence pack** you can hand to Cursor to rebuild a similar app from observed facts only.
- Optional AI keys only structure that Markdown. Analysis still runs with no key.

## Install on Windows

1. Build a per-user setup locally (or use one already produced under `dist/`):

```bash
npm install
npm run pack:win
```

2. Run `dist/APP-Analyzer-Setup-0.1.0.exe` and finish the NSIS wizard. A desktop shortcut named **APP Analyzer** is created for the current user.

`dist/` is gitignored. The installer is not committed.

## Develop

```bash
npm install
npm run dev
npm test
npm run typecheck
```

## How to analyze

1. Open **Analyze**.
2. Pick a target type (Android APK, Windows EXE, web app, tool, package, container, or other archive).
3. Browse to a file or folder, or paste a URL.
4. Click **Start analysis**.

Useful inputs:

| You have | Point the app at |
| --- | --- |
| Installed Electron app | `app.asar` (or the unpacked app folder) from the install directory |
| Android app | `.apk` / `.aab` |
| Source tree | the project folder |
| Website bundle | a zip/folder of front-end files, or a URL |
| Native Windows binary | the `.exe` / `.dll` itself |

A Windows **setup** `.exe` is usually an installer stub (NSIS, 7-Zip SFX). Analyzing that installer does **not** reconstruct the installed product. Prefer the installed `app.asar`, unpacked program files, APK, or source if you want a rebuildable pack.

The app never auto-executes unknown binaries.

## Where reports live

On Windows:

```text
%APPDATA%\Universal Application Analyzer\reports\<job-id>\
```

- `evidence/` — reconstruction pack (`INDEX.md`, `reconstruction.md`, copied `rea-*.json`)
- `<job-id>-full-analysis.md` — one long process report (IDs, timings, inventories)

Open **Report** in the app, or **Open evidence** from a job. Hand the whole `evidence` folder to Cursor, not only `reconstruction.md`.

## Optional AI keys

Settings → **Providers**. Keys are stored only in:

```text
%APPDATA%\Universal Application Analyzer\settings.json
```

They are never written into reports or this git repo.

| Provider | Used for |
| --- | --- |
| NVIDIA NIM | First choice for structuring the long Markdown report |
| OpenAI-compatible | Same chat/completions shape, used if NVIDIA is missing or fails |
| Anthropic | Stored only (no long Markdown adapter yet) |
| Local | Endpoint + optional key, stored only |

Analysis does not require a key.

## Optional tools

On PATH when you need the matching engine:

- REA CLI (`rea-agents`, or `npx -y rea-agents@6.8.0`)
- Ghidra (`GHIDRA_INSTALL_DIR`)
- JDK 17+ and JADX for Android decompilation
- pwntools / WABT for ELF / WASM extras
- A CDP browser for live website capture

Missing tools are reported as skipped, not invented.

## Limits

- No auto-execute of unknown binaries or installers.
- No invented files, APIs, classes, or vulnerabilities.
- No DRM / auth bypass.
- Play Store lookup reads public HTML only.
- ADB does not read private app data.
- API keys stay in local settings and are redacted from Markdown.

## License

Private project source. Use only on software you are authorized to inspect.

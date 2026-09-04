# Sendset

Sendset is a 60-second pre-send check for client files. Drop a messy set, review cleaner filenames and exact duplicates, then download one client-ready ZIP with a plain-text manifest.

The complete experience runs in the browser. File contents are not uploaded or stored.

## Why this exists

Files for a client handoff often arrive through Telegram, email, shared drives, and several review rounds. The work may be polished while the final folder still contains names such as `proposal_FINAL_final_v7 (2).pdf`, copy markers, inconsistent separators, and accidental exact duplicates.

This is a problem I can point to rather than imagine: the Telegram Downloads folder where this project started contained 499 files, and 98 filenames carried copy markers such as `(2)`.

## Core loop

1. Add up to 250 files (1 GB total).
2. Sendset proposes readable, web-safe, or minimally changed filenames.
3. SHA-256 fingerprints identify exact copies and leave the later copies out by default.
4. Every proposed name and inclusion decision remains editable.
5. Download one ZIP containing the selected files and `sendset-manifest.txt`.

The “Load a messy demo” action lets a first-time visitor complete this loop without finding sample files.

## Deliberate scope

The product has no accounts, payments, cloud library, AI API, admin panel, or destructive access to the original folder. It does one job at the moment of handoff. Browser-side deterministic rules keep the result fast, explainable, free, and private.

## Stack

- TypeScript with strict type checking
- Vite
- JSZip for local archive creation
- Web Crypto API for SHA-256 duplicate detection
- Semantic HTML and responsive CSS, without a UI framework

## Run locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Quality checks

```bash
npm run typecheck
npm test
npm run test:e2e
```

The unit suite covers filename parsing, cleanup, transliteration, issue detection, collision handling, and manual-name sanitization. The browser suite completes the demo, downloads and inspects the ZIP, verifies its manifest, and checks the primary experience at a 390 px viewport.

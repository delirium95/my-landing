# Sendset — product brief

## Problem

Freelancers and small client-facing teams often receive deliverables through Telegram, email, shared drives, and multiple feedback rounds. Just before delivery, they spend an awkward final ten minutes removing `(2)`, `copy`, repeated `FINAL`, inconsistent separators, and accidental duplicate files. Sending the messy folder makes otherwise good work feel careless.

## How I know it is real

This is a problem from my own workflow. At the start of the task, my Telegram Downloads folder contained 499 files. Ninety-eight filenames had explicit copy markers, and 18 had opaque hash- or number-like names. The problem is visible in the folder, repeatable, and not dependent on a hypothetical user interview.

## Primary user

A freelancer, operator, recruiter, designer, or small agency teammate who is about to send 3–30 files to a client and wants the handoff to look intentional.

## Job to be done

> When I am about to send a group of finished files, help me remove obvious filename mess and accidental copies so the package looks as professional as the work, without uploading confidential material or learning a new file-management system.

## Product promise

From messy downloads to one client-ready ZIP in under 60 seconds.

## Core loop

Add files → review suggested names and exact duplicates → download a clean ZIP and manifest.

## Product principles

- **Review before magic:** suggestions are visible and editable.
- **Private by architecture:** file bytes are processed in browser memory and are not sent to an application server.
- **One artifact out:** a ZIP and a human-readable change manifest.
- **Useful without setup:** no account, no API key, and an instant demo.

## Non-goals for this version

- Reading document contents with an AI model
- Managing a persistent file library
- Renaming or deleting originals in place
- Collaboration, accounts, payments, or an admin panel
- Solving every possible batch-renaming workflow

## Success signal

A new visitor can understand the promise, run the demo, and download the clean package in the first minute without instructions.

# CogNexa — Frontend

Next.js (App Router) + TypeScript frontend for CogNexa, the dual-mode
research and paper-intelligence agent.

## Stack

- **Next.js 14 (App Router)** — pages, layouts, routing
- **TypeScript** — end to end
- **Tailwind CSS** — styling, dark theme tokens in `app/globals.css`
- **shadcn/ui-style primitives** — `components/ui/*` (button, card, badge,
  input, tabs, dialog, dropdown-menu), built on Radix + CVA
- **TanStack Query** — `lib/queries.ts`, currently backed by mock data in
  `lib/mock-data.ts`
- **Zustand** — `lib/store.ts`, holds sidebar state and one chat history
  per mode (Research / Paper) so switching modes never mixes threads
- **Lucide React** — all icons
- **Recharts** — `components/chat/evidence-chart.tsx`, source-confidence bars
- **React PDF** — `components/paper/pdf-viewer.tsx`
- **SSE** — `app/api/agent-stream/route.ts` streams step-by-step agent
  progress; `lib/use-agent-stream.ts` consumes it with `EventSource`

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000 — `/` always redirects to the **Dashboard**, so that is the first page you see.

## What's real vs. mocked

- The SSE route (`/api/agent-stream`) is a working live stream, but its
  step payloads are hardcoded. Replace `buildSteps()` in
  `app/api/agent-stream/route.ts` with events forwarded from the Python
  agent service.
- `lib/mock-data.ts` stands in for the sessions, papers, report and usage
  endpoints — swap the fetchers in `lib/queries.ts` once they exist. Library
  uploads are local-only until an upload endpoint exists.
- `PdfViewer` points at a placeholder public PDF — wire `fileUrl` to
  wherever the backend serves an uploaded paper.

## Pages

| Route | Page | Purpose |
| --- | --- | --- |
| `/` | — | Redirects to `/dashboard` (app always opens on the Dashboard) |
| `/dashboard` | Dashboard | Recent research, uploaded papers, shortcuts |
| `/research` | Research Mode | Ask a question and follow the agent's progress |
| `/paper-study` | Paper Study Mode | Read a paper, ask questions, generate study materials |
| `/report` | Research Report | Findings, citations, evidence chart |
| `/library` | Paper Library | Upload/manage papers and see processing status |
| `/history` | History | Filter, search, and reopen previous sessions |
| `/settings` | Settings | Account, model preference, usage |

Research Mode and Paper Study Mode share one UI (`components/chat/chat-view.tsx`),
each with its own in-memory thread in the Zustand store.

## Structure

```
app/
  page.tsx              Redirect to /dashboard
  dashboard/ research/ paper-study/ report/ library/ history/ settings/
  api/agent-stream/     SSE route handler
components/
  ui/                   shadcn/ui-style primitives
  layout/               Sidebar + app shell
  chat/                 ChatView, empty state, message bubble, steps card, evidence chart, input bar
  paper/                PDF viewer
lib/
  store.ts              Zustand (chat threads, model preference)
  queries.ts            TanStack Query hooks (sessions, papers, report, usage)
  nav.ts, status.ts     Route helper and shared status labels
  types.ts, mock-data.ts, use-agent-stream.ts, utils.ts
```

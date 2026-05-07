# PI Mono — Architecture & Application Flow

This document is the canonical project guide for architecture, backend flow, and module conventions.

## Overview

PI Mono is a Vue frontend with a TypeScript Node backend (`server/`) where:

- the **backend owns all AI runtime logic**,
- the **frontend only consumes backend APIs and streams**,
- tool execution and subagent spawning happen **server-side only**,
- frontend state changes (settings, credentials metadata, sessions, selection) are persisted through backend endpoints.

## Core Architectural Rule

**No frontend AI runtime.**

The browser must not:

- instantiate the primary AI agent runtime,
- execute tools,
- resolve provider credentials,
- spawn subagents,
- read local AI config directly for runtime decisions.

The backend is the single source of truth for:

- agent profile resolution,
- model/provider resolution,
- credential lookup and refresh,
- tool permission filtering,
- tool execution,
- subagent orchestration,
- agent event streaming.

## Runtime Flow

1. **Server bootstrap**
   - Entry: `server/index.ts`
   - Starts HTTP server via `server/modules/server`.

2. **Request handling**
   - `server/modules/server/index.ts` sets CORS, handles preflight, validates request shape.
   - Delegates to `server/modules/http-router/routeRequest`.

3. **Frontend data loading**
   - FE reads persisted state from `GET /api/state`.
   - FE reads runtime catalog from `GET /api/catalog`.
   - FE renders available agents/models/thinking levels from backend responses.

4. **User message submission**
   - FE appends the user message locally for UI/session continuity.
   - FE posts the full transcript plus selected `agentId`, `modelId`, and `thinkingLevel` to `POST /api/agent/run`.

5. **Backend agent execution**
   - `server/modules/ai-runtime` validates the request.
   - Resolves the selected agent profile from `opencode.json`.
   - Resolves the backend model and provider.
   - Resolves API credentials from persisted backend state.
   - Refreshes OpenAI Codex credentials server-side when needed.
   - Builds the allowed backend tool registry from agent permissions.
   - Runs the agent loop server-side.

6. **Tool and subagent execution**
   - All tool calls execute on the backend only.
   - File tools (`read`, `ls`, `find`, `grep`, `write`, `edit`) are scoped to the workspace.
   - `bash` runs server-side in the workspace.
   - `run_subagent` recursively invokes the same backend runtime with filtered permissions.

7. **Streaming back to the frontend**
   - Backend emits SSE events from the server-owned agent loop.
   - FE consumes those events and appends new transcript messages.
   - FE never executes returned tool calls.

8. **Persistence**
   - FE persists settings/session/selection through backend state endpoints only.
   - Backend remains the authority for credentials and selection used during execution.

## Backend Modules

- `server/modules/ai-runtime`
  - canonical server-owned AI runtime
  - request validation for `/api/agent/run`
  - SSE event streaming
  - server-side tool registry
  - recursive subagent execution
  - backend catalog response for FE

- `server/modules/http-router`
  - endpoint routing
  - includes `/api/agent/run` and `/api/catalog`

- `server/modules/opencode-permissions`
  - reads `../opencode.json`
  - resolves agent profiles
  - derives allowed backend tools from permission definitions
  - determines whether an agent may spawn subagents

- `server/modules/state`
  - persisted settings, credentials metadata, sessions, and selection

- `server/modules/oauth`
  - OAuth exchange/refresh helpers
  - used directly by backend runtime for token refresh

- `server/modules/stream`
  - legacy streaming proxy path
  - no longer the primary application runtime path

- `server/modules/subagent`
  - legacy JSON subagent endpoint
  - no longer the primary application runtime path

## Frontend Modules

- `src/modules/chat/modules/chat/composables/useChatController.ts`
  - FE controller/state only
  - loads backend state/catalog
  - persists settings/session/selection
  - owns transcript display state

- `src/modules/chat/modules/chat/composables/composerActions.ts`
  - posts transcript to `/api/agent/run`
  - consumes SSE events
  - never executes tools locally

- `src/modules/chat/modules/agents/services/backendAgent.ts`
  - thin FE client for backend SSE stream

- `src/modules/chat/modules/persistence/services/serverState.ts`
  - backend state persistence client

- `src/modules/chat/modules/persistence/services/serverCatalog.ts`
  - backend catalog loader

## Architectural Decision: Server Module Structure

All backend feature modules in `server/modules` must use folder-based structure:

- `modules/<feature>/index.ts` — module public API + implementation exports
- `modules/<feature>/types.ts` — module-owned types/interfaces/constants for typing contracts

Why:

- consistent module discovery,
- runtime logic separated from typing contracts,
- easier feature growth with internal helper files later.

## Endpoint Summary

- `GET /api/health` — service health check
- `GET /api/state` — read persisted state
- `GET /api/catalog` — read backend runtime catalog for FE
- `PUT /api/state/settings` — update settings
- `PUT /api/state/openai-codex-credentials` — update credentials metadata
- `PUT /api/state/sessions` — update sessions
- `PUT /api/state/selection` — update current selection
- `POST /api/agent/run` — canonical backend-owned AI run SSE endpoint
- `POST /api/stream` — legacy streaming proxy endpoint
- `POST /api/subagent/run` — legacy subagent endpoint
- `POST /api/ask-subagent` — backward-compatible legacy alias
- `POST /api/openai-codex/oauth/exchange` — OAuth code exchange
- `POST /api/openai-codex/oauth/refresh` — OAuth refresh

## Development Commands

From `pi-mono/`:

- `pnpm dev` — frontend dev server
- `pnpm dev:backend` — backend watch mode
- `pnpm build` — production frontend build
- `pnpm tsc` — typecheck
- `pnpm lint` / `pnpm lint:fix` — linting

# Claude Code Project Context

This file helps Claude Code understand and work with this project effectively.

## Project Overview

This is an **n8n Workflow Manager** - a full-stack TypeScript application for managing workflows across multiple n8n automation platform instances.

## Architecture

### Frontend (Vue 3 + Pinia)

**Entry Point**: `src/client/main.ts`

**Key Files**:
- `src/client/views/Dashboard.vue` - Main workflow browser with filtering, sorting, and bulk actions
- `src/client/views/InstanceConfig.vue` - n8n instance management (add/edit/delete)
- `src/client/components/WorkflowList.vue` - Workflow table with selection, status badges, git status
- `src/client/components/TransferModal.vue` - Modal for transferring workflows between instances
- `src/client/stores/workflows.ts` - Pinia store for workflow state, selection, API calls
- `src/client/stores/instances.ts` - Pinia store for n8n instance CRUD

**State Management Pattern**:
- Workflows are stored per-instance: `workflows[instanceId] = Workflow[]`
- Git status is stored per-workflow: `gitStatus[workflowId] = WorkflowGitStatus`
- Selection uses a `Set<string>` for workflow IDs

### Backend (Express.js)

**Entry Point**: `src/server/index.ts`

**Routes**:
- `src/server/routes/instances.ts` - CRUD for n8n instance configurations
- `src/server/routes/workflows.ts` - List, get, and transfer workflows
- `src/server/routes/git.ts` - Backup and history endpoints

**Services**:
- `src/server/services/n8n-api.ts` - HTTP client for n8n REST API
- `src/server/services/instance-store.ts` - File-based persistence (`data/instances.json`)
- `src/server/services/git-service.ts` - Git operations using simple-git

### Shared Types

`src/shared/types.ts` contains all TypeScript interfaces used by both client and server.

## Key Technical Details

### n8n API Quirks

1. **The `active` field is READ-ONLY** when creating workflows via POST `/api/v1/workflows`. Workflows are created as inactive by default. Do not include `active` in the request body.

2. **Archived workflows**: The n8n API returns an `isArchived` field. We filter these out by default.

3. **API Authentication**: Uses `X-N8N-API-KEY` header with JWT token.

### Git Backup Structure

Workflows are saved to: `data/workflows/<sanitized-instance-name>/<workflow-id>-<sanitized-name>.json`

The sanitization function replaces non-alphanumeric characters with underscores and lowercases.

### Git Status Detection

Compares `workflow.updatedAt` timestamp with the `updatedAt` stored in the backed-up JSON file. If the workflow's timestamp is newer, it's marked as "Modified".

## Common Tasks

### Adding a New Feature to Workflows

1. Update `WorkflowListItem` interface in `src/shared/types.ts`
2. Update `Workflow` interface in `src/client/stores/workflows.ts`
3. If from n8n API, update `listWorkflows()` in `src/server/services/n8n-api.ts`
4. Update UI in `src/client/components/WorkflowList.vue`

### Adding a New API Endpoint

1. Add route handler in appropriate file under `src/server/routes/`
2. If needed, add service function in `src/server/services/`
3. Add store method in `src/client/stores/`
4. Call from Vue component

### Modifying the Dashboard UI

The main dashboard is in `src/client/views/Dashboard.vue`. It uses:
- Instance selector dropdown
- Search input
- Sort dropdowns (field + direction)
- Archive toggle checkbox
- WorkflowList component for the table

## Development Commands

```bash
npm run dev          # Start both client (Vite) and server (tsx watch) with hot reload
npm run build        # Build client with Vite, compile server with tsc
npm start            # Run production build
```

## File Locations

| What | Where |
|------|-------|
| Vue components | `src/client/components/` |
| Page views | `src/client/views/` |
| Pinia stores | `src/client/stores/` |
| Express routes | `src/server/routes/` |
| Business logic | `src/server/services/` |
| TypeScript types | `src/shared/types.ts` |
| Instance configs | `data/instances.json` |
| Workflow backups | `data/workflows/` |

## Error Handling Patterns

- Server routes return `{ success: true, data: ... }` or `{ success: false, error: "..." }`
- Axios errors from n8n API should extract `error.response.data` for the actual message
- Client stores catch errors and store in `error` ref, but also re-throw for components to handle

## Testing the Transfer Feature

Transfer requires:
1. Two or more instances configured
2. At least one workflow selected
3. A different target instance selected

The transfer fetches full workflow data from source and creates in target. Workflows are always created inactive.

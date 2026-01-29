# n8n Workflow Manager

A web-based tool for managing n8n workflows across multiple instances. Browse, backup to Git, and transfer workflows between n8n servers.

## Features

- **Multi-Instance Support**: Connect to multiple n8n instances and switch between them
- **Workflow Browser**: View all workflows with status, last updated time, and Git sync status
- **Git Backup**: Backup selected workflows to a local Git repository with commit messages
- **Transfer Workflows**: Copy workflows from one n8n instance to another
- **Archive Support**: Show/hide archived workflows (hidden by default)
- **Sorting**: Sort workflows by name or last updated date
- **Git Status Tracking**: See which workflows have been modified since their last backup

## Tech Stack

- **Frontend**: Vue 3, Pinia (state management), Vue Router, Tailwind CSS, Vite
- **Backend**: Express.js, Axios, simple-git
- **Language**: TypeScript throughout

## Prerequisites

- Node.js 18+
- Git (for backup functionality)
- Access to one or more n8n instances with API keys

## Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd n8n_workflow_manager
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:5173 in your browser

## Usage

### Adding an n8n Instance

1. Navigate to "Instances" in the sidebar
2. Click "Add Instance"
3. Enter:
   - **Name**: A friendly name for the instance
   - **URL**: The base URL of your n8n instance (e.g., `https://n8n.example.com`)
   - **API Key**: Generate one from n8n Settings > API > Create API Key
   - **Project ID** (optional): For n8n cloud or multi-project setups

### Backing Up Workflows

1. Select workflows using the checkboxes
2. Optionally enter a commit message
3. Click "Backup to Git"
4. Workflows are saved to `data/workflows/<instance-name>/`

### Transferring Workflows

1. Select workflows to transfer
2. Click "Transfer"
3. Select the target instance
4. Workflows are created as **inactive** in the target instance

### Git Status Indicators

- **Synced** (green): Workflow matches the last backup
- **Modified** (yellow): Workflow has changed since last backup
- **Not backed up** (gray): Workflow has never been backed up

## Project Structure

```
workflow_manager/
├── src/
│   ├── client/           # Vue.js frontend
│   │   ├── components/   # Reusable UI components
│   │   ├── stores/       # Pinia state stores
│   │   └── views/        # Page components
│   ├── server/           # Express.js backend
│   │   ├── routes/       # API endpoints
│   │   └── services/     # Business logic
│   └── shared/           # Shared TypeScript types
├── data/                 # Local data storage
│   ├── instances.json    # Saved n8n instance configs
│   └── workflows/        # Git-backed workflow files
└── dist/                 # Production build output
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/instances` | List all configured instances |
| POST | `/api/instances` | Add a new instance |
| DELETE | `/api/instances/:id` | Remove an instance |
| GET | `/api/workflows/:instanceId` | List workflows from an instance |
| POST | `/api/workflows/transfer` | Transfer workflows between instances |
| POST | `/api/git/backup` | Backup workflows to Git |
| GET | `/api/git/history` | Get backup commit history |
| POST | `/api/git/status` | Get Git sync status for workflows |

## Scripts

- `npm run dev` - Start development server (client + server with hot reload)
- `npm run build` - Build for production
- `npm start` - Run production server

## Notes

- Transferred workflows are always created as **inactive** for safety
- The `active` field is read-only in the n8n API
- Workflow backups include full workflow data (nodes, connections, settings)
- Git commits are created automatically when backing up

## License

MIT

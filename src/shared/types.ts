// n8n Instance configuration
export interface N8nInstance {
  id: string
  name: string
  url: string
  apiKey: string
  projectId?: string
  createdAt: string
  lastConnected?: string
}

// n8n Workflow (simplified from n8n's full type)
export interface N8nWorkflow {
  id: string
  name: string
  active: boolean
  createdAt: string
  updatedAt: string
  tags?: Array<{ id: string; name: string }>
  nodes?: N8nNode[]
  connections?: Record<string, unknown>
  settings?: Record<string, unknown>
  staticData?: unknown
  pinData?: Record<string, unknown>
}

export interface N8nNode {
  id: string
  name: string
  type: string
  position: [number, number]
  parameters: Record<string, unknown>
  credentials?: Record<string, unknown>
}

// Workflow list item (returned from /workflows endpoint)
export interface WorkflowListItem {
  id: string
  name: string
  active: boolean
  createdAt: string
  updatedAt: string
  isArchived?: boolean
  tags?: Array<{ id: string; name: string }>
}

// Git status for a workflow
export interface WorkflowGitStatus {
  workflowId: string
  hasBackup: boolean
  lastBackupDate?: string
  isModified: boolean
}

// API responses
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface WorkflowListResponse {
  data: WorkflowListItem[]
  nextCursor?: string
}

// Git operations
export interface GitCommit {
  hash: string
  date: string
  message: string
  author: string
}

export interface BackupRequest {
  instanceId: string
  workflowIds: string[]
  message?: string
}

export interface TransferRequest {
  sourceInstanceId: string
  targetInstanceId: string
  workflowIds: string[]
}

export interface TransferResult {
  workflowId: string
  workflowName: string
  status: 'success' | 'error'
  newId?: string
  error?: string
}

import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

export interface N8nProject {
  id: string
  name: string
  type: 'personal' | 'team'
}

export interface Workflow {
  id: string
  name: string
  active: boolean
  createdAt: string
  updatedAt: string
  isArchived?: boolean
  tags?: Array<{ id: string; name: string }>
  homeProject?: N8nProject
  sharedWithProjects?: N8nProject[]
}

export interface WorkflowGitStatus {
  workflowId: string
  hasBackup: boolean
  lastBackupDate?: string
  isModified: boolean
}

export interface TransferResult {
  workflowId: string
  workflowName: string
  status: 'success' | 'error'
  newId?: string
  error?: string
}

export interface MigrateAnalysis {
  selectedWorkflows: Array<{ id: string; name: string }>
  additionalSubworkflows: Array<{ id: string; name: string; referencedBy: string }>
  existingWorkflows: Array<{ sourceId: string; targetId: string; name: string }>
  newWorkflows: Array<{ sourceId: string; name: string }>
  matchedCredentials: Array<{ name: string; type: string; resolvedVia: 'phase0' | 'api' }>
  missingCredentials: Array<{ name: string; type: string; usedByWorkflows: string[] }>
  credentialsApiAvailable: boolean
  matchedDataTables: Array<{ name: string; resolvedVia: 'phase0' | 'api' }>
  missingDataTables: Array<{ name: string; usedByWorkflows: string[] }>
  dataTablesApiAvailable: boolean
  matchedTags: Array<{ name: string }>
  createdTags: Array<{ name: string }>
  tagsApiAvailable: boolean
  dynamicReferences: Array<{ workflowName: string; nodeName: string; expression: string }>
  brokenReferences: Array<{ workflowName: string; nodeName: string }>
}

export interface MigrateResult {
  workflowId: string
  workflowName: string
  sourceId: string
  status: 'created' | 'updated' | 'error'
  targetId?: string
  error?: string
}

export interface GitCommit {
  hash: string
  date: string
  message: string
  author: string
}

export const useWorkflowsStore = defineStore('workflows', () => {
  const workflows = ref<Record<string, Workflow[]>>({})
  const gitStatus = ref<Record<string, WorkflowGitStatus>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selectedWorkflows = ref<Set<string>>(new Set())

  async function fetchWorkflows(instanceId: string, includeArchived = false) {
    loading.value = true
    error.value = null
    try {
      const response = await axios.get(`/api/workflows/${instanceId}`, {
        params: { includeArchived }
      })
      workflows.value[instanceId] = response.data.data
      // Fetch git status for the workflows
      await fetchGitStatus(instanceId)
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  async function fetchGitStatus(instanceId: string) {
    const instanceWorkflows = workflows.value[instanceId]
    if (!instanceWorkflows?.length) return

    try {
      const response = await axios.post('/api/git/status', {
        instanceId,
        workflows: instanceWorkflows.map(w => ({ id: w.id, updatedAt: w.updatedAt }))
      })
      const statusList: WorkflowGitStatus[] = response.data.data
      statusList.forEach(s => {
        gitStatus.value[s.workflowId] = s
      })
    } catch {
      // Git status is optional, don't fail if it errors
    }
  }

  function toggleWorkflowSelection(workflowId: string) {
    if (selectedWorkflows.value.has(workflowId)) {
      selectedWorkflows.value.delete(workflowId)
    } else {
      selectedWorkflows.value.add(workflowId)
    }
  }

  function clearSelection() {
    selectedWorkflows.value.clear()
  }

  function selectAll(instanceId: string) {
    const instanceWorkflows = workflows.value[instanceId] || []
    instanceWorkflows.forEach(w => selectedWorkflows.value.add(w.id))
  }

  async function backupWorkflows(instanceId: string, workflowIds: string[], message?: string): Promise<GitCommit> {
    loading.value = true
    error.value = null
    try {
      const response = await axios.post('/api/git/backup', { instanceId, workflowIds, message })
      return response.data.data
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function transferWorkflows(
    sourceInstanceId: string,
    targetInstanceId: string,
    workflowIds: string[],
    targetProjectId?: string
  ): Promise<TransferResult[]> {
    loading.value = true
    error.value = null
    try {
      const response = await axios.post('/api/workflows/transfer', {
        sourceInstanceId,
        targetInstanceId,
        workflowIds,
        targetProjectId
      })
      return response.data.data
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function analyzeMigration(
    sourceInstanceId: string,
    targetInstanceId: string,
    workflowIds: string[],
    targetProjectId?: string
  ): Promise<MigrateAnalysis> {
    const response = await axios.post('/api/migrate/analyze', {
      sourceInstanceId, targetInstanceId, workflowIds, targetProjectId
    })
    return response.data.data
  }

  async function executeMigration(
    sourceInstanceId: string,
    targetInstanceId: string,
    workflowIds: string[],
    targetProjectId?: string
  ): Promise<MigrateResult[]> {
    loading.value = true
    error.value = null
    try {
      const response = await axios.post('/api/migrate/execute', {
        sourceInstanceId, targetInstanceId, workflowIds, targetProjectId
      })
      return response.data.data
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function fetchProjects(instanceId: string): Promise<N8nProject[]> {
    try {
      const response = await axios.get(`/api/workflows/${instanceId}/projects`)
      return response.data.data || []
    } catch {
      return []
    }
  }

  async function getBackupHistory(): Promise<GitCommit[]> {
    try {
      const response = await axios.get('/api/git/history')
      return response.data.data
    } catch {
      return []
    }
  }

  return {
    workflows,
    gitStatus,
    loading,
    error,
    selectedWorkflows,
    fetchWorkflows,
    fetchGitStatus,
    fetchProjects,
    toggleWorkflowSelection,
    clearSelection,
    selectAll,
    backupWorkflows,
    transferWorkflows,
    analyzeMigration,
    executeMigration,
    getBackupHistory
  }
})

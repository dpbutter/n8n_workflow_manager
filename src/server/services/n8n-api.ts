import axios, { AxiosInstance } from 'axios'
import type { N8nInstance, N8nWorkflow, N8nProject, WorkflowListItem, WorkflowListResponse } from '../../shared/types.js'

export class N8nApiService {
  private client: AxiosInstance

  constructor(instance: N8nInstance) {
    this.client = axios.create({
      baseURL: `${instance.url}/api/v1`,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': instance.apiKey
      }
    })
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/workflows', { params: { limit: 1 } })
      return response.status === 200
    } catch {
      return false
    }
  }

  async listProjects(): Promise<N8nProject[]> {
    try {
      const response = await this.client.get<{ data: N8nProject[] }>('/projects')
      return response.data.data || []
    } catch {
      // Projects endpoint may not exist in older n8n versions or API key lacks permission
      return []
    }
  }

  async listWorkflows(projectId?: string, includeArchived = false): Promise<WorkflowListItem[]> {
    const params: Record<string, unknown> = { limit: 250 }
    if (projectId) {
      params.projectId = projectId
    }

    // Fetch workflows and projects in parallel
    const [workflowsResponse, projects] = await Promise.all([
      this.client.get<WorkflowListResponse>('/workflows', { params }),
      this.listProjects()
    ])

    // Build a lookup map for projects by ID
    const projectMap = new Map<string, N8nProject>()
    for (const p of projects) {
      projectMap.set(p.id, p)
    }

    let workflows = workflowsResponse.data.data.map(wf => {
      const raw = wf as unknown as {
        isArchived?: boolean
        shared?: Array<{ projectId?: string; project?: N8nProject }>
      }
      const sharedEntry = raw.shared?.[0]
      // Try: shared[0].project > lookup by projectId > create placeholder with just ID
      let homeProject = sharedEntry?.project || (sharedEntry?.projectId ? projectMap.get(sharedEntry.projectId) : undefined)
      // Fallback: if we have a projectId but couldn't get the name, show the ID
      if (!homeProject && sharedEntry?.projectId) {
        homeProject = { id: sharedEntry.projectId, name: sharedEntry.projectId, type: 'team' }
      }
      return {
        ...wf,
        isArchived: raw.isArchived ?? false,
        homeProject
      }
    })

    if (!includeArchived) {
      workflows = workflows.filter(wf => !wf.isArchived)
    }

    return workflows
  }

  async getWorkflow(workflowId: string): Promise<N8nWorkflow> {
    const response = await this.client.get<N8nWorkflow>(`/workflows/${workflowId}`, {
      params: { excludePinnedData: true }
    })
    return response.data
  }

  async createWorkflow(workflow: Partial<N8nWorkflow>, projectId?: string): Promise<N8nWorkflow> {
    const params: Record<string, string> = {}
    if (projectId) {
      params.projectId = projectId
    }
    const response = await this.client.post<N8nWorkflow>('/workflows', workflow, { params })
    return response.data
  }

  async updateWorkflow(workflowId: string, workflow: Partial<N8nWorkflow>): Promise<N8nWorkflow> {
    const response = await this.client.put<N8nWorkflow>(`/workflows/${workflowId}`, workflow)
    return response.data
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    await this.client.delete(`/workflows/${workflowId}`)
  }
}

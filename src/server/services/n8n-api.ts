import axios, { AxiosInstance } from 'axios'
import type { N8nInstance, N8nWorkflow, WorkflowListItem, WorkflowListResponse } from '../../shared/types.js'

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

  async listWorkflows(projectId?: string, includeArchived = false): Promise<WorkflowListItem[]> {
    const params: Record<string, unknown> = { limit: 250 }
    if (projectId) {
      params.projectId = projectId
    }

    const response = await this.client.get<WorkflowListResponse>('/workflows', { params })
    let workflows = response.data.data.map(wf => ({
      ...wf,
      isArchived: (wf as unknown as { isArchived?: boolean }).isArchived ?? false
    }))

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

  async createWorkflow(workflow: Partial<N8nWorkflow>): Promise<N8nWorkflow> {
    const response = await this.client.post<N8nWorkflow>('/workflows', workflow)
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

import { Router } from 'express'
import * as instanceStore from '../services/instance-store.js'
import { N8nApiService } from '../services/n8n-api.js'

const router = Router()

// List workflows from an instance
router.get('/:instanceId', async (req, res) => {
  try {
    const instance = await instanceStore.getInstanceById(req.params.instanceId)
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Instance not found' })
    }

    const includeArchived = req.query.includeArchived === 'true'
    const api = new N8nApiService(instance)
    const workflows = await api.listWorkflows(instance.projectId, includeArchived)

    res.json({ success: true, data: workflows })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

// Get a single workflow
router.get('/:instanceId/:workflowId', async (req, res) => {
  try {
    const instance = await instanceStore.getInstanceById(req.params.instanceId)
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Instance not found' })
    }

    const api = new N8nApiService(instance)
    const workflow = await api.getWorkflow(req.params.workflowId)

    res.json({ success: true, data: workflow })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

// Transfer workflows to another instance
router.post('/transfer', async (req, res) => {
  try {
    const { sourceInstanceId, targetInstanceId, workflowIds } = req.body

    if (!sourceInstanceId || !targetInstanceId || !workflowIds?.length) {
      return res.status(400).json({
        success: false,
        error: 'sourceInstanceId, targetInstanceId, and workflowIds are required'
      })
    }

    const sourceInstance = await instanceStore.getInstanceById(sourceInstanceId)
    const targetInstance = await instanceStore.getInstanceById(targetInstanceId)

    if (!sourceInstance) {
      return res.status(404).json({ success: false, error: 'Source instance not found' })
    }
    if (!targetInstance) {
      return res.status(404).json({ success: false, error: 'Target instance not found' })
    }

    const sourceApi = new N8nApiService(sourceInstance)
    const targetApi = new N8nApiService(targetInstance)

    const results = []

    for (const workflowId of workflowIds) {
      try {
        // Get workflow from source
        const workflow = await sourceApi.getWorkflow(workflowId)

        // Prepare for import (remove id - workflows are created as inactive by default)
        const importData = {
          name: workflow.name,
          nodes: workflow.nodes,
          connections: workflow.connections,
          settings: workflow.settings
        }

        // Create in target
        const created = await targetApi.createWorkflow(importData)

        results.push({
          workflowId,
          workflowName: workflow.name,
          status: 'success' as const,
          newId: created.id
        })
      } catch (error: unknown) {
        // Extract detailed error from axios
        let errorMsg = String(error)
        if (error && typeof error === 'object' && 'response' in error) {
          const axiosErr = error as { response?: { data?: unknown; status?: number } }
          errorMsg = JSON.stringify(axiosErr.response?.data) || `Status ${axiosErr.response?.status}`
        }
        results.push({
          workflowId,
          workflowName: workflowId,
          status: 'error' as const,
          error: errorMsg
        })
      }
    }

    res.json({ success: true, data: results })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

export default router

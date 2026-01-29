import { Router } from 'express'
import * as instanceStore from '../services/instance-store.js'
import { N8nApiService } from '../services/n8n-api.js'
import * as gitService from '../services/git-service.js'

const router = Router()

// Backup workflows to git
router.post('/backup', async (req, res) => {
  try {
    const { instanceId, workflowIds, message } = req.body

    if (!instanceId || !workflowIds?.length) {
      return res.status(400).json({
        success: false,
        error: 'instanceId and workflowIds are required'
      })
    }

    const instance = await instanceStore.getInstanceById(instanceId)
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Instance not found' })
    }

    const api = new N8nApiService(instance)

    // Fetch all workflows
    const workflows = await Promise.all(
      workflowIds.map((id: string) => api.getWorkflow(id))
    )

    // Backup to git
    const commit = await gitService.backupWorkflows(instance.name, workflows, message)

    res.json({ success: true, data: commit })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

// Get backup history
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    const history = await gitService.getBackupHistory(limit)
    res.json({ success: true, data: history })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

// Get git status for workflows
router.post('/status', async (req, res) => {
  try {
    const { instanceId, workflows } = req.body

    if (!instanceId || !workflows?.length) {
      return res.status(400).json({
        success: false,
        error: 'instanceId and workflows are required'
      })
    }

    const instance = await instanceStore.getInstanceById(instanceId)
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Instance not found' })
    }

    const status = await gitService.getWorkflowsGitStatus(instance.name, workflows)
    res.json({ success: true, data: status })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

export default router

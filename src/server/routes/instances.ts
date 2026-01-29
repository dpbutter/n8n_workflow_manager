import { Router } from 'express'
import * as instanceStore from '../services/instance-store.js'
import { N8nApiService } from '../services/n8n-api.js'

const router = Router()

// List all instances
router.get('/', async (req, res) => {
  try {
    const instances = await instanceStore.getAllInstances()
    // Don't send API keys to frontend
    const sanitized = instances.map(({ apiKey, ...rest }) => ({
      ...rest,
      hasApiKey: !!apiKey
    }))
    res.json({ success: true, data: sanitized })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

// Get single instance
router.get('/:id', async (req, res) => {
  try {
    const instance = await instanceStore.getInstanceById(req.params.id)
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Instance not found' })
    }
    const { apiKey, ...sanitized } = instance
    res.json({ success: true, data: { ...sanitized, hasApiKey: !!apiKey } })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

// Create instance
router.post('/', async (req, res) => {
  try {
    const { name, url, apiKey, projectId } = req.body
    if (!name || !url || !apiKey) {
      return res.status(400).json({ success: false, error: 'name, url, and apiKey are required' })
    }

    const instance = await instanceStore.createInstance({ name, url, apiKey, projectId })
    const { apiKey: _, ...sanitized } = instance
    res.status(201).json({ success: true, data: { ...sanitized, hasApiKey: true } })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

// Update instance
router.put('/:id', async (req, res) => {
  try {
    const { name, url, apiKey, projectId } = req.body
    const instance = await instanceStore.updateInstance(req.params.id, { name, url, apiKey, projectId })
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Instance not found' })
    }
    const { apiKey: _, ...sanitized } = instance
    res.json({ success: true, data: { ...sanitized, hasApiKey: !!instance.apiKey } })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

// Delete instance
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await instanceStore.deleteInstance(req.params.id)
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Instance not found' })
    }
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

// Test connection
router.post('/:id/test', async (req, res) => {
  try {
    const instance = await instanceStore.getInstanceById(req.params.id)
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Instance not found' })
    }

    const api = new N8nApiService(instance)
    const connected = await api.testConnection()

    if (connected) {
      await instanceStore.updateInstance(instance.id, { lastConnected: new Date().toISOString() })
    }

    res.json({ success: true, data: { connected } })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

// Test connection before saving (with provided credentials)
router.post('/test-connection', async (req, res) => {
  try {
    const { url, apiKey } = req.body
    if (!url || !apiKey) {
      return res.status(400).json({ success: false, error: 'url and apiKey are required' })
    }

    const api = new N8nApiService({ id: '', name: '', url, apiKey, createdAt: '' })
    const connected = await api.testConnection()

    res.json({ success: true, data: { connected } })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

export default router

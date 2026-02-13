import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

export interface Instance {
  id: string
  name: string
  url: string
  projectId?: string
  hasApiKey: boolean
  createdAt: string
  lastConnected?: string
}

export type ConnectionStatus = 'unknown' | 'testing' | 'connected' | 'failed'

export const useInstancesStore = defineStore('instances', () => {
  const instances = ref<Instance[]>([])
  const connectionStatus = ref<Record<string, ConnectionStatus>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchInstances() {
    loading.value = true
    error.value = null
    try {
      const response = await axios.get('/api/instances')
      instances.value = response.data.data
      // Auto-test all instances in parallel
      testAllConnections()
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  function testAllConnections() {
    for (const instance of instances.value) {
      if (instance.hasApiKey) {
        testConnection(instance.id)
      } else {
        connectionStatus.value[instance.id] = 'failed'
      }
    }
  }

  async function testConnection(id: string): Promise<boolean> {
    connectionStatus.value[id] = 'testing'
    try {
      const response = await axios.post(`/api/instances/${id}/test`)
      const connected = response.data.data.connected
      connectionStatus.value[id] = connected ? 'connected' : 'failed'
      return connected
    } catch {
      connectionStatus.value[id] = 'failed'
      return false
    }
  }

  async function createInstance(data: { name: string; url: string; apiKey: string; projectId?: string }) {
    loading.value = true
    error.value = null
    try {
      const response = await axios.post('/api/instances', data)
      instances.value.push(response.data.data)
      // Auto-test the new instance
      testConnection(response.data.data.id)
      return response.data.data
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function updateInstance(id: string, data: Partial<{ name: string; url: string; apiKey: string; projectId?: string }>) {
    loading.value = true
    error.value = null
    try {
      const response = await axios.put(`/api/instances/${id}`, data)
      const index = instances.value.findIndex(i => i.id === id)
      if (index !== -1) {
        instances.value[index] = response.data.data
      }
      // Re-test after update
      testConnection(id)
      return response.data.data
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function deleteInstance(id: string) {
    loading.value = true
    error.value = null
    try {
      await axios.delete(`/api/instances/${id}`)
      instances.value = instances.value.filter(i => i.id !== id)
      delete connectionStatus.value[id]
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function testNewConnection(url: string, apiKey: string): Promise<boolean> {
    try {
      const response = await axios.post('/api/instances/test-connection', { url, apiKey })
      return response.data.data.connected
    } catch {
      return false
    }
  }

  return {
    instances,
    connectionStatus,
    loading,
    error,
    fetchInstances,
    createInstance,
    updateInstance,
    deleteInstance,
    testConnection,
    testNewConnection
  }
})

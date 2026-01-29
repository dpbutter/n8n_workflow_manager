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

export const useInstancesStore = defineStore('instances', () => {
  const instances = ref<Instance[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchInstances() {
    loading.value = true
    error.value = null
    try {
      const response = await axios.get('/api/instances')
      instances.value = response.data.data
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  async function createInstance(data: { name: string; url: string; apiKey: string; projectId?: string }) {
    loading.value = true
    error.value = null
    try {
      const response = await axios.post('/api/instances', data)
      instances.value.push(response.data.data)
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
    } catch (e) {
      error.value = String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function testConnection(id: string): Promise<boolean> {
    try {
      const response = await axios.post(`/api/instances/${id}/test`)
      return response.data.data.connected
    } catch {
      return false
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

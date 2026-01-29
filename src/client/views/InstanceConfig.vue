<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useInstancesStore } from '../stores/instances'

const router = useRouter()
const store = useInstancesStore()

const showForm = ref(false)
const form = ref({
  name: '',
  url: '',
  apiKey: '',
  projectId: ''
})
const testingConnection = ref(false)
const connectionStatus = ref<'untested' | 'success' | 'failed'>('untested')
const editingId = ref<string | null>(null)

onMounted(() => {
  store.fetchInstances()
})

function openForm(instance?: typeof store.instances.value[0]) {
  if (instance) {
    editingId.value = instance.id
    form.value = {
      name: instance.name,
      url: instance.url,
      apiKey: '',
      projectId: instance.projectId || ''
    }
  } else {
    editingId.value = null
    form.value = { name: '', url: '', apiKey: '', projectId: '' }
  }
  connectionStatus.value = 'untested'
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  editingId.value = null
  form.value = { name: '', url: '', apiKey: '', projectId: '' }
}

async function testConnection() {
  testingConnection.value = true
  const connected = await store.testNewConnection(form.value.url, form.value.apiKey)
  connectionStatus.value = connected ? 'success' : 'failed'
  testingConnection.value = false
}

async function saveInstance() {
  if (editingId.value) {
    await store.updateInstance(editingId.value, {
      name: form.value.name,
      url: form.value.url,
      apiKey: form.value.apiKey || undefined,
      projectId: form.value.projectId || undefined
    })
  } else {
    await store.createInstance({
      name: form.value.name,
      url: form.value.url,
      apiKey: form.value.apiKey,
      projectId: form.value.projectId || undefined
    })
  }
  closeForm()
}

async function deleteInstance(id: string) {
  if (confirm('Are you sure you want to delete this instance?')) {
    await store.deleteInstance(id)
  }
}
</script>

<template>
  <div class="px-4">
    <div class="sm:flex sm:items-center">
      <div class="sm:flex-auto">
        <h1 class="text-2xl font-semibold text-gray-900">n8n Instances</h1>
        <p class="mt-2 text-sm text-gray-700">Manage your n8n instance connections.</p>
      </div>
      <div class="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
        <button
          @click="openForm()"
          class="block rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          Add Instance
        </button>
      </div>
    </div>

    <!-- Instance List -->
    <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="instance in store.instances"
        :key="instance.id"
        class="bg-white rounded-lg shadow p-6"
      >
        <div class="flex items-start justify-between">
          <div>
            <h3 class="text-lg font-medium text-gray-900">{{ instance.name }}</h3>
            <p class="mt-1 text-sm text-gray-500 truncate">{{ instance.url }}</p>
            <p v-if="instance.projectId" class="mt-1 text-xs text-gray-400">
              Project: {{ instance.projectId }}
            </p>
          </div>
          <span
            :class="[
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
              instance.hasApiKey ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            ]"
          >
            {{ instance.hasApiKey ? 'Connected' : 'No Key' }}
          </span>
        </div>
        <div class="mt-4 flex space-x-2">
          <button
            @click="openForm(instance)"
            class="text-sm text-indigo-600 hover:text-indigo-500"
          >
            Edit
          </button>
          <button
            @click="deleteInstance(instance.id)"
            class="text-sm text-red-600 hover:text-red-500"
          >
            Delete
          </button>
        </div>
      </div>
    </div>

    <div v-if="store.instances.length === 0 && !store.loading" class="mt-8 text-center">
      <p class="text-gray-500">No instances configured. Add your first n8n instance to get started.</p>
    </div>

    <!-- Form Modal -->
    <div v-if="showForm" class="fixed inset-0 z-10 overflow-y-auto">
      <div class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
        <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" @click="closeForm"></div>
        <div class="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
          <h3 class="text-lg font-semibold mb-4">
            {{ editingId ? 'Edit Instance' : 'Add Instance' }}
          </h3>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700">Name</label>
              <input
                v-model="form.name"
                type="text"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                placeholder="Production"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700">URL</label>
              <input
                v-model="form.url"
                type="url"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                placeholder="https://n8n.example.com"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700">API Key</label>
              <input
                v-model="form.apiKey"
                type="password"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                :placeholder="editingId ? '(unchanged)' : 'Enter API key'"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700">Project ID (optional)</label>
              <input
                v-model="form.projectId"
                type="text"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                placeholder="Leave empty for all projects"
              />
            </div>

            <div class="flex items-center space-x-2">
              <button
                @click="testConnection"
                :disabled="testingConnection || !form.url || !form.apiKey"
                class="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-200 disabled:opacity-50"
              >
                {{ testingConnection ? 'Testing...' : 'Test Connection' }}
              </button>
              <span v-if="connectionStatus === 'success'" class="text-green-600 text-sm">Connected!</span>
              <span v-if="connectionStatus === 'failed'" class="text-red-600 text-sm">Connection failed</span>
            </div>
          </div>

          <div class="mt-6 flex justify-end space-x-3">
            <button
              @click="closeForm"
              class="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              @click="saveInstance"
              :disabled="!form.name || !form.url || (!editingId && !form.apiKey)"
              class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {{ editingId ? 'Update' : 'Create' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useWorkflowsStore, type TransferResult, type N8nProject } from '../stores/workflows'
import type { Instance } from '../stores/instances'

const props = defineProps<{
  sourceInstanceId: string
  workflowIds: string[]
  instances: Instance[]
}>()

const emit = defineEmits<{
  close: []
  transferred: []
}>()

const workflowsStore = useWorkflowsStore()
const targetInstanceId = ref<string | null>(null)
const targetProjectId = ref<string | null>(null)
const targetProjects = ref<N8nProject[]>([])
const loadingProjects = ref(false)
const transferring = ref(false)
const results = ref<TransferResult[] | null>(null)
const errorMessage = ref<string | null>(null)

// Fetch projects when target instance changes
watch(targetInstanceId, async (newId) => {
  targetProjectId.value = null
  targetProjects.value = []
  if (newId) {
    loadingProjects.value = true
    try {
      targetProjects.value = await workflowsStore.fetchProjects(newId)
    } finally {
      loadingProjects.value = false
    }
  }
})

const availableTargets = computed(() => {
  return props.instances.filter(i => i.id !== props.sourceInstanceId)
})

const sourceInstance = computed(() => {
  return props.instances.find(i => i.id === props.sourceInstanceId)
})

const targetInstance = computed(() => {
  if (!targetInstanceId.value) return null
  return props.instances.find(i => i.id === targetInstanceId.value)
})

async function transfer() {
  if (!targetInstanceId.value) return

  transferring.value = true
  errorMessage.value = null
  try {
    results.value = await workflowsStore.transferWorkflows(
      props.sourceInstanceId,
      targetInstanceId.value,
      props.workflowIds,
      targetProjectId.value || undefined
    )
  } catch (e: unknown) {
    console.error('Transfer failed:', e)
    // Extract error message from axios error
    if (e && typeof e === 'object') {
      const err = e as { response?: { data?: { error?: string }; status?: number }; message?: string }
      if (err.response?.data?.error) {
        errorMessage.value = err.response.data.error
      } else if (err.response?.status) {
        errorMessage.value = `Server returned status ${err.response.status}`
      } else if (err.message) {
        errorMessage.value = err.message
      } else {
        errorMessage.value = String(e)
      }
    } else {
      errorMessage.value = String(e)
    }
  } finally {
    transferring.value = false
  }
}

function done() {
  emit('transferred')
}
</script>

<template>
  <div class="fixed inset-0 z-10 overflow-y-auto">
    <div class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
      <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" @click="emit('close')"></div>
      <div class="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
        <h3 class="text-lg font-semibold mb-4">Transfer Workflows</h3>

        <!-- Pre-transfer -->
        <div v-if="!results">
          <p class="text-sm text-gray-600 mb-4">
            Transfer {{ workflowIds.length }} workflow(s) from
            <strong>{{ sourceInstance?.name }}</strong>
            to another instance.
          </p>

          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700">Target Instance</label>
            <select
              v-model="targetInstanceId"
              class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            >
              <option :value="null" disabled>Select target instance</option>
              <option v-for="instance in availableTargets" :key="instance.id" :value="instance.id">
                {{ instance.name }}
              </option>
            </select>
          </div>

          <div v-if="targetInstanceId" class="mb-4">
            <label class="block text-sm font-medium text-gray-700">Target Project (optional)</label>
            <select
              v-model="targetProjectId"
              :disabled="loadingProjects"
              class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 disabled:opacity-50"
            >
              <option :value="null">{{ loadingProjects ? 'Loading projects...' : 'Default (personal project)' }}</option>
              <option v-for="project in targetProjects" :key="project.id" :value="project.id">
                {{ project.name }} {{ project.type === 'personal' ? '(Personal)' : '' }}
              </option>
            </select>
            <p v-if="!loadingProjects && targetProjects.length === 0" class="mt-1 text-xs text-gray-500">
              No projects found or projects API not available
            </p>
          </div>

          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
            <p class="text-sm text-yellow-800">
              Workflows will be imported as <strong>inactive</strong> in the target instance.
              You'll need to activate them manually after reviewing.
            </p>
          </div>

          <div v-if="errorMessage" class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p class="text-sm text-red-800">{{ errorMessage }}</p>
          </div>

          <div class="flex justify-end space-x-3">
            <button
              @click="emit('close')"
              class="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              @click="transfer"
              :disabled="!targetInstanceId || transferring"
              class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {{ transferring ? 'Transferring...' : 'Transfer' }}
            </button>
          </div>
        </div>

        <!-- Post-transfer Results -->
        <div v-else>
          <p class="text-sm text-gray-600 mb-4">
            Transfer to <strong>{{ targetInstance?.name }}</strong> complete.
          </p>

          <div class="space-y-2 max-h-64 overflow-y-auto">
            <div
              v-for="result in results"
              :key="result.workflowId"
              :class="[
                'rounded-lg p-3',
                result.status === 'success' ? 'bg-green-50' : 'bg-red-50'
              ]"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">{{ result.workflowName }}</span>
                <span
                  :class="[
                    'text-xs',
                    result.status === 'success' ? 'text-green-700' : 'text-red-700'
                  ]"
                >
                  {{ result.status === 'success' ? 'Success' : 'Failed' }}
                </span>
              </div>
              <p v-if="result.newId" class="text-xs text-gray-500 mt-1">
                New ID: {{ result.newId }}
              </p>
              <p v-if="result.error" class="text-xs text-red-600 mt-1">
                {{ result.error }}
              </p>
            </div>
          </div>

          <div class="mt-4 flex justify-end">
            <button
              @click="done"
              class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

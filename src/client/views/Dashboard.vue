<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useInstancesStore } from '../stores/instances'
import { useWorkflowsStore, type Workflow } from '../stores/workflows'
import WorkflowList from '../components/WorkflowList.vue'
import TransferModal from '../components/TransferModal.vue'

const instancesStore = useInstancesStore()
const workflowsStore = useWorkflowsStore()

const selectedInstanceId = ref<string | null>(null)
const showTransferModal = ref(false)
const searchQuery = ref('')
const backupMessage = ref('')
const showBackupSuccess = ref(false)
const showArchived = ref(false)
const sortField = ref<'name' | 'updatedAt'>('updatedAt')
const sortDirection = ref<'asc' | 'desc'>('desc')

onMounted(async () => {
  await instancesStore.fetchInstances()
  if (instancesStore.instances.length > 0) {
    selectedInstanceId.value = instancesStore.instances[0].id
  }
})

watch(selectedInstanceId, (newId) => {
  if (newId) {
    workflowsStore.clearSelection()
    workflowsStore.fetchWorkflows(newId, showArchived.value)
  }
})

watch(showArchived, (includeArchived) => {
  if (selectedInstanceId.value) {
    workflowsStore.fetchWorkflows(selectedInstanceId.value, includeArchived)
  }
})

const selectedInstance = computed(() => {
  return instancesStore.instances.find(i => i.id === selectedInstanceId.value)
})

const workflows = computed(() => {
  if (!selectedInstanceId.value) return []
  let all = workflowsStore.workflows[selectedInstanceId.value] || []

  // Filter by search
  if (searchQuery.value) {
    all = all.filter(w => w.name.toLowerCase().includes(searchQuery.value.toLowerCase()))
  }

  // Sort
  const sorted = [...all].sort((a, b) => {
    let cmp = 0
    if (sortField.value === 'name') {
      cmp = a.name.localeCompare(b.name)
    } else {
      cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    }
    return sortDirection.value === 'asc' ? cmp : -cmp
  })

  return sorted
})

function handleSort(field: 'name' | 'updatedAt', defaultDir: 'asc' | 'desc') {
  if (sortField.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortDirection.value = defaultDir
  }
}

const selectedCount = computed(() => workflowsStore.selectedWorkflows.size)

async function backupSelected() {
  if (!selectedInstanceId.value || selectedCount.value === 0) return

  const ids = Array.from(workflowsStore.selectedWorkflows)
  await workflowsStore.backupWorkflows(selectedInstanceId.value, ids, backupMessage.value || undefined)
  backupMessage.value = ''
  showBackupSuccess.value = true
  // Refresh git status after backup
  await workflowsStore.fetchGitStatus(selectedInstanceId.value)
  setTimeout(() => showBackupSuccess.value = false, 3000)
}

function openTransfer() {
  if (selectedCount.value > 0) {
    showTransferModal.value = true
  }
}
</script>

<template>
  <div class="px-4">
    <div class="sm:flex sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">Workflows</h1>
        <p class="mt-2 text-sm text-gray-700">Browse and manage your n8n workflows.</p>
      </div>
    </div>

    <!-- Instance Selector & Search -->
    <div class="mt-6 flex flex-col sm:flex-row gap-4">
      <div class="sm:w-64">
        <label class="block text-sm font-medium text-gray-700">Instance</label>
        <select
          v-model="selectedInstanceId"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
        >
          <option v-for="instance in instancesStore.instances" :key="instance.id" :value="instance.id">
            {{ instance.name }}
          </option>
        </select>
      </div>

      <div class="flex-1">
        <label class="block text-sm font-medium text-gray-700">Search</label>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search workflows..."
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
        />
      </div>

      <div class="sm:w-48">
        <label class="block text-sm font-medium text-gray-700">Sort by</label>
        <select
          v-model="sortField"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
        >
          <option value="name">Name</option>
          <option value="updatedAt">Updated</option>
        </select>
      </div>

      <div class="sm:w-32">
        <label class="block text-sm font-medium text-gray-700">Order</label>
        <select
          v-model="sortDirection"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
        >
          <option value="asc">Asc</option>
          <option value="desc">Desc</option>
        </select>
      </div>
    </div>

    <!-- Filters -->
    <div class="mt-4 flex items-center gap-4">
      <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          v-model="showArchived"
          type="checkbox"
          class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
        />
        Show archived workflows
      </label>
    </div>

    <!-- Action Bar -->
    <div v-if="selectedCount > 0" class="mt-4 bg-indigo-50 rounded-lg p-4 flex items-center justify-between">
      <span class="text-sm text-indigo-700">{{ selectedCount }} workflow(s) selected</span>
      <div class="flex items-center gap-4">
        <input
          v-model="backupMessage"
          type="text"
          placeholder="Backup message (optional)"
          class="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm border p-2"
        />
        <button
          @click="backupSelected"
          class="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500"
        >
          Backup to Git
        </button>
        <button
          @click="openTransfer"
          :disabled="instancesStore.instances.length < 2"
          class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
        >
          Transfer
        </button>
        <button
          @click="workflowsStore.clearSelection()"
          class="text-sm text-gray-600 hover:text-gray-900"
        >
          Clear
        </button>
      </div>
    </div>

    <!-- Success Message -->
    <div v-if="showBackupSuccess" class="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
      <p class="text-sm text-green-800">Workflows backed up successfully!</p>
    </div>

    <!-- No Instances -->
    <div v-if="instancesStore.instances.length === 0 && !instancesStore.loading" class="mt-8 text-center py-12">
      <p class="text-gray-500">No instances configured.</p>
      <router-link to="/instances" class="mt-2 inline-block text-indigo-600 hover:text-indigo-500">
        Add your first n8n instance
      </router-link>
    </div>

    <!-- Workflow List -->
    <WorkflowList
      v-else-if="selectedInstanceId"
      :workflows="workflows"
      :loading="workflowsStore.loading"
      :selected-workflows="workflowsStore.selectedWorkflows"
      :git-status="workflowsStore.gitStatus"
      @toggle="workflowsStore.toggleWorkflowSelection"
      @select-all="workflowsStore.selectAll(selectedInstanceId!)"
      @sort="handleSort"
      class="mt-6"
    />

    <!-- Transfer Modal -->
    <TransferModal
      v-if="showTransferModal"
      :source-instance-id="selectedInstanceId!"
      :workflow-ids="Array.from(workflowsStore.selectedWorkflows)"
      :instances="instancesStore.instances"
      @close="showTransferModal = false"
      @transferred="workflowsStore.clearSelection(); showTransferModal = false"
    />
  </div>
</template>

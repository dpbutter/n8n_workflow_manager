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

// Filters
const filterProject = ref<string | null>(null)
const filterStatus = ref<'all' | 'active' | 'inactive'>('all')
const filterTag = ref<string | null>(null)
const filterGitStatus = ref<'all' | 'synced' | 'modified' | 'not_backed_up'>('all')

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
    // Reset filters when instance changes
    filterProject.value = null
    filterStatus.value = 'all'
    filterTag.value = null
    filterGitStatus.value = 'all'
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

// Get unique projects from workflows
const uniqueProjects = computed(() => {
  if (!selectedInstanceId.value) return []
  const all = workflowsStore.workflows[selectedInstanceId.value] || []
  const projectMap = new Map<string, { id: string; name: string }>()
  for (const w of all) {
    if (w.homeProject) {
      projectMap.set(w.homeProject.id, { id: w.homeProject.id, name: w.homeProject.name })
    }
  }
  return Array.from(projectMap.values()).sort((a, b) => a.name.localeCompare(b.name))
})

// Get unique tags from workflows
const uniqueTags = computed(() => {
  if (!selectedInstanceId.value) return []
  const all = workflowsStore.workflows[selectedInstanceId.value] || []
  const tagSet = new Set<string>()
  for (const w of all) {
    for (const tag of w.tags || []) {
      tagSet.add(tag.name)
    }
  }
  return Array.from(tagSet).sort()
})

const workflows = computed(() => {
  if (!selectedInstanceId.value) return []
  let all = workflowsStore.workflows[selectedInstanceId.value] || []

  // Filter by search
  if (searchQuery.value) {
    all = all.filter(w => w.name.toLowerCase().includes(searchQuery.value.toLowerCase()))
  }

  // Filter by project
  if (filterProject.value) {
    all = all.filter(w => w.homeProject?.id === filterProject.value)
  }

  // Filter by status
  if (filterStatus.value === 'active') {
    all = all.filter(w => w.active)
  } else if (filterStatus.value === 'inactive') {
    all = all.filter(w => !w.active)
  }

  // Filter by tag
  if (filterTag.value) {
    all = all.filter(w => w.tags?.some(t => t.name === filterTag.value))
  }

  // Filter by git status
  if (filterGitStatus.value !== 'all') {
    all = all.filter(w => {
      const status = workflowsStore.gitStatus[w.id]
      if (filterGitStatus.value === 'synced') {
        return status?.hasBackup && !status?.isModified
      } else if (filterGitStatus.value === 'modified') {
        return status?.hasBackup && status?.isModified
      } else if (filterGitStatus.value === 'not_backed_up') {
        return !status?.hasBackup
      }
      return true
    })
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
    <div class="mt-4 flex flex-wrap items-center gap-4">
      <div class="sm:w-40">
        <label class="block text-xs font-medium text-gray-500">Project</label>
        <select
          v-model="filterProject"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm border p-1.5"
        >
          <option :value="null">All projects</option>
          <option v-for="project in uniqueProjects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </div>

      <div class="sm:w-32">
        <label class="block text-xs font-medium text-gray-500">Status</label>
        <select
          v-model="filterStatus"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm border p-1.5"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div class="sm:w-40">
        <label class="block text-xs font-medium text-gray-500">Tag</label>
        <select
          v-model="filterTag"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm border p-1.5"
        >
          <option :value="null">All tags</option>
          <option v-for="tag in uniqueTags" :key="tag" :value="tag">
            {{ tag }}
          </option>
        </select>
      </div>

      <div class="sm:w-40">
        <label class="block text-xs font-medium text-gray-500">Git Status</label>
        <select
          v-model="filterGitStatus"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm border p-1.5"
        >
          <option value="all">All</option>
          <option value="synced">Synced</option>
          <option value="modified">Modified</option>
          <option value="not_backed_up">Not backed up</option>
        </select>
      </div>

      <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mt-5">
        <input
          v-model="showArchived"
          type="checkbox"
          class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
        />
        Show archived
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

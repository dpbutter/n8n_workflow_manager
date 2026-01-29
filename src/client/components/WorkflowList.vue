<script setup lang="ts">
import type { Workflow, WorkflowGitStatus } from '../stores/workflows'

defineProps<{
  workflows: Workflow[]
  loading: boolean
  selectedWorkflows: Set<string>
  gitStatus: Record<string, WorkflowGitStatus>
}>()

const emit = defineEmits<{
  toggle: [workflowId: string]
  selectAll: []
  sort: [field: 'name' | 'updatedAt', direction: 'asc' | 'desc']
}>()

function formatDateTime(dateStr: string) {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }) + ' ' + date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getGitStatusLabel(status: WorkflowGitStatus | undefined) {
  if (!status || !status.hasBackup) return { text: 'Not backed up', class: 'bg-gray-100 text-gray-600' }
  if (status.isModified) return { text: 'Modified', class: 'bg-yellow-100 text-yellow-800' }
  return { text: 'Synced', class: 'bg-green-100 text-green-700' }
}
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="loading" class="text-center py-12">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      <p class="mt-2 text-gray-500">Loading workflows...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="workflows.length === 0" class="text-center py-12">
      <p class="text-gray-500">No workflows found.</p>
    </div>

    <!-- Workflow Table -->
    <div v-else class="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
      <table class="min-w-full divide-y divide-gray-300">
        <thead class="bg-gray-50">
          <tr>
            <th scope="col" class="relative px-6 py-3">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                @change="emit('selectAll')"
              />
            </th>
            <th
              scope="col"
              class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 cursor-pointer hover:text-gray-700"
              @click="emit('sort', 'name', 'asc')"
            >
              Name
            </th>
            <th scope="col" class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Status
            </th>
            <th
              scope="col"
              class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 cursor-pointer hover:text-gray-700"
              @click="emit('sort', 'updatedAt', 'desc')"
            >
              Updated
            </th>
            <th scope="col" class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Git
            </th>
            <th scope="col" class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              ID
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 bg-white">
          <tr
            v-for="workflow in workflows"
            :key="workflow.id"
            :class="[
              selectedWorkflows.has(workflow.id) ? 'bg-indigo-50' : '',
              workflow.isArchived ? 'opacity-60' : ''
            ]"
            class="hover:bg-gray-50 cursor-pointer"
            @click="emit('toggle', workflow.id)"
          >
            <td class="relative px-6 py-4" @click.stop>
              <input
                type="checkbox"
                :checked="selectedWorkflows.has(workflow.id)"
                class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                @change="emit('toggle', workflow.id)"
              />
            </td>
            <td class="whitespace-nowrap px-3 py-4 text-sm font-medium text-gray-900">
              <span class="flex items-center gap-2">
                {{ workflow.name }}
                <span
                  v-if="workflow.isArchived"
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700"
                >
                  Archived
                </span>
              </span>
            </td>
            <td class="whitespace-nowrap px-3 py-4 text-sm">
              <span
                :class="[
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                  workflow.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                ]"
              >
                {{ workflow.active ? 'Active' : 'Inactive' }}
              </span>
            </td>
            <td class="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
              {{ formatDateTime(workflow.updatedAt) }}
            </td>
            <td class="whitespace-nowrap px-3 py-4 text-sm">
              <span
                :class="[
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  getGitStatusLabel(gitStatus[workflow.id]).class
                ]"
              >
                {{ getGitStatusLabel(gitStatus[workflow.id]).text }}
              </span>
            </td>
            <td class="whitespace-nowrap px-3 py-4 text-sm text-gray-400 font-mono">
              {{ workflow.id }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

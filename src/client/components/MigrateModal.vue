<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useWorkflowsStore, type MigrateAnalysis, type MigrateResult, type N8nProject } from '../stores/workflows'
import type { Instance } from '../stores/instances'

const props = defineProps<{
  sourceInstanceId: string
  workflowIds: string[]
  instances: Instance[]
}>()

const emit = defineEmits<{
  close: []
  migrated: []
}>()

const workflowsStore = useWorkflowsStore()
const targetInstanceId = ref<string | null>(null)
const targetProjectId = ref<string | null>(null)
const targetProjects = ref<N8nProject[]>([])
const loadingProjects = ref(false)

// Phase state
const phase = ref<'configure' | 'review' | 'results'>('configure')
const analyzing = ref(false)
const migrating = ref(false)
const analysis = ref<MigrateAnalysis | null>(null)
const results = ref<MigrateResult[] | null>(null)
const errorMessage = ref<string | null>(null)

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

async function analyze() {
  if (!targetInstanceId.value) return
  analyzing.value = true
  errorMessage.value = null
  try {
    analysis.value = await workflowsStore.analyzeMigration(
      props.sourceInstanceId,
      targetInstanceId.value,
      props.workflowIds,
      targetProjectId.value || undefined
    )
    phase.value = 'review'
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } }; message?: string }
    errorMessage.value = err.response?.data?.error || err.message || String(e)
  } finally {
    analyzing.value = false
  }
}

async function migrate() {
  if (!targetInstanceId.value) return
  migrating.value = true
  errorMessage.value = null
  try {
    results.value = await workflowsStore.executeMigration(
      props.sourceInstanceId,
      targetInstanceId.value,
      props.workflowIds,
      targetProjectId.value || undefined
    )
    phase.value = 'results'
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } }; message?: string }
    errorMessage.value = err.response?.data?.error || err.message || String(e)
  } finally {
    migrating.value = false
  }
}

function done() {
  emit('migrated')
}
</script>

<template>
  <div class="fixed inset-0 z-10 overflow-y-auto">
    <div class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
      <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" @click="emit('close')"></div>
      <div class="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl sm:p-6">
        <h3 class="text-lg font-semibold mb-4">Migrate Workflows</h3>

        <!-- Phase 1: Configure -->
        <div v-if="phase === 'configure'">
          <p class="text-sm text-gray-600 mb-4">
            Migrate {{ workflowIds.length }} workflow(s) from
            <strong>{{ sourceInstance?.name }}</strong>
            with subworkflow discovery and credential remapping.
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
              @click="analyze"
              :disabled="!targetInstanceId || analyzing"
              class="rounded-md bg-purple-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-500 disabled:opacity-50"
            >
              {{ analyzing ? 'Analyzing...' : 'Analyze' }}
            </button>
          </div>
        </div>

        <!-- Phase 2: Review Analysis -->
        <div v-else-if="phase === 'review' && analysis">
          <div class="space-y-4 max-h-96 overflow-y-auto pr-2">
            <!-- Selected workflows -->
            <div>
              <h4 class="text-sm font-medium text-gray-900">Selected Workflows ({{ analysis.selectedWorkflows.length }})</h4>
              <ul class="mt-1 text-sm text-gray-600">
                <li v-for="w in analysis.selectedWorkflows" :key="w.id">{{ w.name }}</li>
              </ul>
            </div>

            <!-- Additional subworkflows -->
            <div v-if="analysis.additionalSubworkflows.length > 0" class="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <h4 class="text-sm font-medium text-blue-800">Additional Subworkflows Discovered ({{ analysis.additionalSubworkflows.length }})</h4>
              <p class="text-xs text-blue-700 mb-1">These will also be migrated.</p>
              <ul class="text-sm text-blue-700">
                <li v-for="w in analysis.additionalSubworkflows" :key="w.id">
                  {{ w.name }} <span class="text-xs text-blue-500">(referenced by {{ w.referencedBy }})</span>
                </li>
              </ul>
            </div>

            <!-- Existing in target -->
            <div v-if="analysis.existingWorkflows.length > 0">
              <h4 class="text-sm font-medium text-gray-900">Will Update in Target ({{ analysis.existingWorkflows.length }})</h4>
              <ul class="mt-1 text-sm text-gray-600">
                <li v-for="w in analysis.existingWorkflows" :key="w.sourceId">
                  {{ w.name }} <span class="text-xs text-gray-400">({{ w.sourceId }} &rarr; {{ w.targetId }})</span>
                </li>
              </ul>
            </div>

            <!-- New to target -->
            <div v-if="analysis.newWorkflows.length > 0">
              <h4 class="text-sm font-medium text-gray-900">Will Create in Target ({{ analysis.newWorkflows.length }})</h4>
              <ul class="mt-1 text-sm text-gray-600">
                <li v-for="w in analysis.newWorkflows" :key="w.sourceId">{{ w.name }}</li>
              </ul>
            </div>

            <!-- Matched credentials -->
            <div v-if="analysis.matchedCredentials.length > 0" class="bg-green-50 border border-green-200 rounded-lg p-3">
              <h4 class="text-sm font-medium text-green-800">Credentials Matched ({{ analysis.matchedCredentials.length }})</h4>
              <ul class="text-sm text-green-700">
                <li v-for="c in analysis.matchedCredentials" :key="c.name + c.type">
                  {{ c.name }} <span class="text-xs">({{ c.type }}, via {{ c.resolvedVia === 'phase0' ? 'existing target' : 'API' }})</span>
                </li>
              </ul>
            </div>

            <!-- Missing credentials -->
            <div v-if="analysis.missingCredentials.length > 0" class="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <h4 class="text-sm font-medium text-amber-800">Missing Credentials ({{ analysis.missingCredentials.length }})</h4>
              <p class="text-xs text-amber-700 mb-1">You'll need to create these in the target instance. Workflows referencing them will be migrated but won't run until credentials are configured.</p>
              <ul class="text-sm text-amber-700">
                <li v-for="c in analysis.missingCredentials" :key="c.name + c.type">
                  {{ c.name }} ({{ c.type }}) &mdash; used by {{ c.usedByWorkflows.join(', ') }}
                </li>
              </ul>
            </div>

            <!-- Dynamic references -->
            <div v-if="analysis.dynamicReferences.length > 0" class="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <h4 class="text-sm font-medium text-amber-800">Dynamic References ({{ analysis.dynamicReferences.length }})</h4>
              <p class="text-xs text-amber-700 mb-1">These nodes use expressions for workflow IDs and can't be auto-remapped.</p>
              <ul class="text-sm text-amber-700">
                <li v-for="(r, i) in analysis.dynamicReferences" :key="i">
                  {{ r.workflowName }} &rarr; {{ r.nodeName }}
                </li>
              </ul>
            </div>

            <!-- Broken references -->
            <div v-if="analysis.brokenReferences.length > 0" class="bg-red-50 border border-red-200 rounded-lg p-3">
              <h4 class="text-sm font-medium text-red-800">Broken References ({{ analysis.brokenReferences.length }})</h4>
              <p class="text-xs text-red-700 mb-1">These nodes have corrupted workflow ID references.</p>
              <ul class="text-sm text-red-700">
                <li v-for="(r, i) in analysis.brokenReferences" :key="i">
                  {{ r.workflowName }} &rarr; {{ r.nodeName }}
                </li>
              </ul>
            </div>

            <!-- Credentials API note -->
            <div v-if="!analysis.credentialsApiAvailable" class="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p class="text-xs text-gray-600">
                Credentials API not available on target. Credential matching for new workflows is limited — you may need to wire credentials manually.
              </p>
            </div>
          </div>

          <div v-if="errorMessage" class="bg-red-50 border border-red-200 rounded-lg p-3 mt-4">
            <p class="text-sm text-red-800">{{ errorMessage }}</p>
          </div>

          <div class="mt-4 flex justify-end space-x-3">
            <button
              @click="phase = 'configure'; analysis = null"
              class="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              Back
            </button>
            <button
              @click="migrate"
              :disabled="migrating"
              class="rounded-md bg-purple-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-500 disabled:opacity-50"
            >
              {{ migrating ? 'Migrating...' : 'Migrate' }}
            </button>
          </div>
        </div>

        <!-- Phase 3: Results -->
        <div v-else-if="phase === 'results' && results">
          <p class="text-sm text-gray-600 mb-4">
            Migration to <strong>{{ targetInstance?.name }}</strong> complete.
          </p>

          <div class="space-y-2 max-h-64 overflow-y-auto">
            <div
              v-for="result in results"
              :key="result.workflowId"
              :class="[
                'rounded-lg p-3',
                result.status === 'error' ? 'bg-red-50' : result.status === 'created' ? 'bg-green-50' : 'bg-blue-50'
              ]"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">{{ result.workflowName }}</span>
                <span
                  :class="[
                    'text-xs font-medium px-2 py-0.5 rounded',
                    result.status === 'created' ? 'bg-green-100 text-green-700' :
                    result.status === 'updated' ? 'bg-blue-100 text-blue-700' :
                    'bg-red-100 text-red-700'
                  ]"
                >
                  {{ result.status === 'created' ? 'Created' : result.status === 'updated' ? 'Updated' : 'Error' }}
                </span>
              </div>
              <p v-if="result.targetId" class="text-xs text-gray-500 mt-1">
                Target ID: {{ result.targetId }}
              </p>
              <p v-if="result.error" class="text-xs text-red-600 mt-1">
                {{ result.error }}
              </p>
            </div>
          </div>

          <div class="mt-4 flex justify-end">
            <button
              @click="done"
              class="rounded-md bg-purple-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-500"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

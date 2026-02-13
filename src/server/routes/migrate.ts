import { Router, Request, Response } from 'express'
import { N8nApiService } from '../services/n8n-api.js'
import * as instanceStore from '../services/instance-store.js'
import type {
  N8nWorkflow,
  N8nNode,
  N8nCredentialRef,
  MigrateRequest,
  MigrateAnalysis,
  MigrateResult,
  WorkflowListItem,
} from '../../shared/types.js'

const router = Router()

// --- Helpers ---

const EXECUTE_WORKFLOW_TYPES = [
  'n8n-nodes-base.executeWorkflow',
  'n8n-nodes-langchain.toolWorkflow',
]

const DATA_TABLE_TYPE = 'n8n-nodes-base.dataTable'

interface WorkflowRefExtraction {
  id: string | null
  isDynamic: boolean
  isBroken: boolean
  expression?: string
}

function extractWorkflowRef(node: N8nNode): WorkflowRefExtraction {
  const widArg = node.parameters?.workflowId as unknown
  if (!widArg) return { id: null, isDynamic: false, isBroken: false }

  if (typeof widArg === 'object' && widArg !== null) {
    const obj = widArg as Record<string, unknown>
    const value = obj.value as string | undefined
    if (!value) return { id: null, isDynamic: false, isBroken: false }
    if (value.includes('${undefined}')) return { id: null, isDynamic: false, isBroken: true }
    if (value.startsWith('={{')) return { id: null, isDynamic: true, isBroken: false, expression: value }
    return { id: value, isDynamic: false, isBroken: false }
  }

  if (typeof widArg === 'string') {
    if (widArg.includes('${undefined}')) return { id: null, isDynamic: false, isBroken: true }
    if (widArg.startsWith('={{')) return { id: null, isDynamic: true, isBroken: false, expression: widArg }
    return { id: widArg, isDynamic: false, isBroken: false }
  }

  return { id: null, isDynamic: false, isBroken: false }
}

interface CredentialRef {
  name: string
  type: string
}

function extractCredentialRefs(nodes: N8nNode[]): CredentialRef[] {
  const seen = new Set<string>()
  const refs: CredentialRef[] = []
  for (const node of nodes) {
    if (!node.credentials) continue
    for (const [type, cred] of Object.entries(node.credentials)) {
      const credObj = cred as Record<string, unknown>
      const name = (credObj.name as string) || ''
      const key = `${type}::${name}`
      if (!seen.has(key) && name) {
        seen.add(key)
        refs.push({ name, type })
      }
    }
  }
  return refs
}

interface DiscoveryResult {
  workflow: N8nWorkflow
  referencedBy: string | null // null = user-selected, string = parent workflow name
}

async function discoverDependencies(
  api: N8nApiService,
  workflowId: string,
  visited: Set<string>,
  referencedBy: string | null,
  results: DiscoveryResult[],
  dynamicRefs: MigrateAnalysis['dynamicReferences'],
  brokenRefs: MigrateAnalysis['brokenReferences']
): Promise<void> {
  if (visited.has(workflowId)) return
  visited.add(workflowId)

  let workflow: N8nWorkflow
  try {
    workflow = await api.getWorkflow(workflowId)
  } catch (e) {
    console.warn(`[Migrate] Could not fetch workflow ${workflowId}: ${(e as Error).message}`)
    return
  }

  results.push({ workflow, referencedBy })

  for (const node of workflow.nodes || []) {
    if (!EXECUTE_WORKFLOW_TYPES.includes(node.type)) continue

    const ref = extractWorkflowRef(node)
    if (ref.isBroken) {
      brokenRefs.push({ workflowName: workflow.name, nodeName: node.name })
      continue
    }
    if (ref.isDynamic) {
      dynamicRefs.push({ workflowName: workflow.name, nodeName: node.name, expression: ref.expression || '' })
      continue
    }
    if (ref.id && !visited.has(ref.id)) {
      await discoverDependencies(api, ref.id, visited, workflow.name, results, dynamicRefs, brokenRefs)
    }
  }
}

const ALLOWED_SETTINGS = new Set([
  'executionOrder',
  'errorWorkflow',
  'timezone',
  'saveManualExecutions',
  'callerPolicy',
  'callerIds',
  'executionTimeout',
  'maxExecutionTimeout',
  'saveDataErrorExecution',
  'saveDataSuccessExecution',
  'saveExecutionProgress',
])

function scrubSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const key of Object.keys(settings)) {
    if (ALLOWED_SETTINGS.has(key)) {
      clean[key] = settings[key]
    }
  }
  return clean
}

function scrubForDeploy(workflow: N8nWorkflow): Record<string, unknown> {
  // Allow-list: only include fields the n8n API accepts for create/update
  const settings = scrubSettings(
    (workflow.settings as Record<string, unknown>) || { executionOrder: 'v1' }
  )
  if (!settings.executionOrder) settings.executionOrder = 'v1'

  const body: Record<string, unknown> = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings,
  }
  if (workflow.staticData) body.staticData = workflow.staticData
  return body
}

function rewriteWorkflowRefs(nodes: N8nNode[], idMap: Map<string, string>): void {
  for (const node of nodes) {
    if (!EXECUTE_WORKFLOW_TYPES.includes(node.type)) continue

    const widArg = node.parameters?.workflowId as unknown
    if (!widArg) continue

    if (typeof widArg === 'object' && widArg !== null) {
      const obj = widArg as Record<string, unknown>
      const currentId = obj.value as string | undefined
      if (currentId && idMap.has(currentId)) {
        obj.value = idMap.get(currentId)
      }
    } else if (typeof widArg === 'string') {
      if (idMap.has(widArg)) {
        node.parameters.workflowId = idMap.get(widArg)!
      }
    }
  }
}

function applyPhase0Credentials(sourceNodes: N8nNode[], targetNodes: N8nNode[]): void {
  for (const srcNode of sourceNodes) {
    if (!srcNode.credentials) continue
    const tgtNode = targetNodes.find(n => n.name === srcNode.name && n.type === srcNode.type)
    if (!tgtNode?.credentials) continue
    for (const type of Object.keys(srcNode.credentials)) {
      const srcCred = srcNode.credentials[type] as Record<string, unknown>
      const tgtCred = tgtNode.credentials[type] as Record<string, unknown> | undefined
      if (tgtCred) {
        srcCred.id = tgtCred.id
      }
    }
  }
}

function applyCredentialsApi(
  nodes: N8nNode[],
  credMap: Map<string, string> // "name::type" -> targetId
): { matched: CredentialRef[]; missing: CredentialRef[] } {
  const matched: CredentialRef[] = []
  const missing: CredentialRef[] = []
  const seen = new Set<string>()

  for (const node of nodes) {
    if (!node.credentials) continue
    for (const [type, cred] of Object.entries(node.credentials)) {
      const credObj = cred as Record<string, unknown>
      const name = (credObj.name as string) || ''
      const key = `${type}::${name}`
      if (seen.has(key)) continue
      seen.add(key)

      const targetId = credMap.get(key)
      if (targetId) {
        credObj.id = targetId
        matched.push({ name, type })
      } else if (name) {
        missing.push({ name, type })
      }
    }
  }
  return { matched, missing }
}

// --- Data Table helpers ---

interface DataTableRef {
  id: string
  name: string
}

function extractDataTableRef(node: N8nNode): DataTableRef | null {
  if (node.type !== DATA_TABLE_TYPE) return null
  const dtArg = node.parameters?.dataTableId as unknown
  if (!dtArg || typeof dtArg !== 'object') return null

  const obj = dtArg as Record<string, unknown>
  const id = obj.value as string | undefined
  const name = obj.cachedResultName as string | undefined
  if (!id || !name) return null
  return { id, name }
}

function extractDataTableRefs(nodes: N8nNode[]): Array<{ name: string; nodeNames: string[] }> {
  const byName = new Map<string, string[]>()
  for (const node of nodes) {
    const ref = extractDataTableRef(node)
    if (!ref) continue
    if (!byName.has(ref.name)) byName.set(ref.name, [])
    byName.get(ref.name)!.push(node.name)
  }
  return Array.from(byName.entries()).map(([name, nodeNames]) => ({ name, nodeNames }))
}

function rewriteDataTableRefs(nodes: N8nNode[], idMap: Map<string, string>): void {
  for (const node of nodes) {
    if (node.type !== DATA_TABLE_TYPE) continue
    const dtArg = node.parameters?.dataTableId as unknown
    if (!dtArg || typeof dtArg !== 'object') continue

    const obj = dtArg as Record<string, unknown>
    const currentId = obj.value as string | undefined
    if (currentId && idMap.has(currentId)) {
      obj.value = idMap.get(currentId)
    }
  }
}

function applyPhase0DataTables(sourceNodes: N8nNode[], targetNodes: N8nNode[]): void {
  for (const srcNode of sourceNodes) {
    if (srcNode.type !== DATA_TABLE_TYPE) continue
    const tgtNode = targetNodes.find(n => n.name === srcNode.name && n.type === srcNode.type)
    if (!tgtNode) continue

    const srcDt = srcNode.parameters?.dataTableId as Record<string, unknown> | undefined
    const tgtDt = tgtNode.parameters?.dataTableId as Record<string, unknown> | undefined
    if (srcDt && tgtDt?.value) {
      srcDt.value = tgtDt.value
    }
  }
}

// Topological sort — leaves first
function topoSort(
  workflows: N8nWorkflow[],
  getChildIds: (w: N8nWorkflow) => string[]
): N8nWorkflow[] {
  const idSet = new Set(workflows.map(w => w.id))
  const adj = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  for (const w of workflows) {
    adj.set(w.id, [])
    inDegree.set(w.id, 0)
  }

  // parent -> child edges: parent depends on child
  for (const w of workflows) {
    for (const childId of getChildIds(w)) {
      if (idSet.has(childId)) {
        adj.get(childId)!.push(w.id) // child must come before parent
        inDegree.set(w.id, (inDegree.get(w.id) || 0) + 1)
      }
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    sorted.push(id)
    for (const next of adj.get(id) || []) {
      const newDeg = (inDegree.get(next) || 1) - 1
      inDegree.set(next, newDeg)
      if (newDeg === 0) queue.push(next)
    }
  }

  // If cycles exist, append remaining
  for (const w of workflows) {
    if (!sorted.includes(w.id)) sorted.push(w.id)
  }

  const byId = new Map(workflows.map(w => [w.id, w]))
  return sorted.map(id => byId.get(id)!).filter(Boolean)
}

function getChildWorkflowIds(workflow: N8nWorkflow): string[] {
  const ids: string[] = []
  for (const node of workflow.nodes || []) {
    if (!EXECUTE_WORKFLOW_TYPES.includes(node.type)) continue
    const ref = extractWorkflowRef(node)
    if (ref.id) ids.push(ref.id)
  }
  return ids
}

// --- Endpoints ---

async function runAnalysis(req: MigrateRequest): Promise<MigrateAnalysis> {
  const sourceInstance = await instanceStore.getInstanceById(req.sourceInstanceId)
  const targetInstance = await instanceStore.getInstanceById(req.targetInstanceId)
  if (!sourceInstance || !targetInstance) throw new Error('Instance not found')

  const sourceApi = new N8nApiService(sourceInstance)
  const targetApi = new N8nApiService(targetInstance)

  // Discover all workflows (selected + subworkflow dependencies)
  const visited = new Set<string>()
  const discovered: DiscoveryResult[] = []
  const dynamicReferences: MigrateAnalysis['dynamicReferences'] = []
  const brokenReferences: MigrateAnalysis['brokenReferences'] = []

  for (const wfId of req.workflowIds) {
    await discoverDependencies(sourceApi, wfId, visited, null, discovered, dynamicReferences, brokenReferences)
  }

  // Reclassify: if a workflow was discovered as a subworkflow but is also
  // user-selected, treat it as user-selected (referencedBy = null)
  const selectedIdSet = new Set(req.workflowIds)
  for (const d of discovered) {
    if (d.referencedBy !== null && selectedIdSet.has(d.workflow.id)) {
      d.referencedBy = null
    }
  }

  const selectedWorkflows = discovered
    .filter(d => d.referencedBy === null)
    .map(d => ({ id: d.workflow.id, name: d.workflow.name }))

  const additionalSubworkflows = discovered
    .filter(d => d.referencedBy !== null)
    .map(d => ({ id: d.workflow.id, name: d.workflow.name, referencedBy: d.referencedBy! }))

  // Query target
  const targetWorkflows = await targetApi.listAllWorkflows()
  const targetByName = new Map<string, WorkflowListItem>()
  for (const tw of targetWorkflows) {
    targetByName.set(tw.name, tw)
  }

  // Classify existing vs new
  const existingWorkflows: MigrateAnalysis['existingWorkflows'] = []
  const newWorkflows: MigrateAnalysis['newWorkflows'] = []

  for (const d of discovered) {
    const target = targetByName.get(d.workflow.name)
    if (target) {
      existingWorkflows.push({ sourceId: d.workflow.id, targetId: target.id, name: d.workflow.name })
    } else {
      newWorkflows.push({ sourceId: d.workflow.id, name: d.workflow.name })
    }
  }

  // Credential analysis
  const matchedCredentials: MigrateAnalysis['matchedCredentials'] = []
  const missingCredentials: MigrateAnalysis['missingCredentials'] = []
  const matchedCredKeys = new Set<string>()
  const missingCredMap = new Map<string, { name: string; type: string; usedByWorkflows: string[] }>()

  // Phase 0: For existing workflows, match credentials from target
  for (const existing of existingWorkflows) {
    const sourceWf = discovered.find(d => d.workflow.id === existing.sourceId)!.workflow
    try {
      const targetWf = await targetApi.getWorkflow(existing.targetId)
      for (const srcNode of sourceWf.nodes || []) {
        if (!srcNode.credentials) continue
        const tgtNode = (targetWf.nodes || []).find(n => n.name === srcNode.name && n.type === srcNode.type)
        for (const [type, cred] of Object.entries(srcNode.credentials)) {
          const credObj = cred as Record<string, unknown>
          const name = (credObj.name as string) || ''
          const key = `${type}::${name}`
          if (!name || matchedCredKeys.has(key)) continue

          const tgtCred = tgtNode?.credentials?.[type] as Record<string, unknown> | undefined
          if (tgtCred?.id) {
            matchedCredKeys.add(key)
            matchedCredentials.push({ name, type, resolvedVia: 'phase0' })
          }
        }
      }
    } catch {
      // Skip if can't fetch target workflow
    }
  }

  // Tier 2: Credentials API for remaining
  let credentialsApiAvailable = false
  let targetCredMap = new Map<string, string>()

  try {
    const targetCreds = await targetApi.listCredentials()
    credentialsApiAvailable = true
    for (const c of targetCreds) {
      targetCredMap.set(`${c.type}::${c.name}`, c.id)
    }
  } catch {
    credentialsApiAvailable = false
  }

  // Check all workflows for unmatched credentials
  for (const d of discovered) {
    const credRefs = extractCredentialRefs(d.workflow.nodes || [])
    for (const cr of credRefs) {
      const key = `${cr.type}::${cr.name}`
      if (matchedCredKeys.has(key)) continue

      if (credentialsApiAvailable && targetCredMap.has(key)) {
        matchedCredKeys.add(key)
        matchedCredentials.push({ name: cr.name, type: cr.type, resolvedVia: 'api' })
      } else {
        if (!missingCredMap.has(key)) {
          missingCredMap.set(key, { name: cr.name, type: cr.type, usedByWorkflows: [] })
        }
        const entry = missingCredMap.get(key)!
        if (!entry.usedByWorkflows.includes(d.workflow.name)) {
          entry.usedByWorkflows.push(d.workflow.name)
        }
      }
    }
  }

  // Remove from missing if matched
  for (const key of matchedCredKeys) {
    missingCredMap.delete(key)
  }

  // Data table analysis
  const matchedDataTables: MigrateAnalysis['matchedDataTables'] = []
  const missingDataTableMap = new Map<string, { name: string; usedByWorkflows: string[] }>()
  const matchedDtNames = new Set<string>()

  // Phase 0: For existing workflows, match data tables from target nodes
  for (const existing of existingWorkflows) {
    const sourceWf = discovered.find(d => d.workflow.id === existing.sourceId)!.workflow
    try {
      const targetWf = await targetApi.getWorkflow(existing.targetId)
      for (const srcNode of sourceWf.nodes || []) {
        const srcRef = extractDataTableRef(srcNode)
        if (!srcRef || matchedDtNames.has(srcRef.name)) continue

        const tgtNode = (targetWf.nodes || []).find(n => n.name === srcNode.name && n.type === srcNode.type)
        const tgtRef = tgtNode ? extractDataTableRef(tgtNode) : null
        if (tgtRef) {
          matchedDtNames.add(srcRef.name)
          matchedDataTables.push({ name: srcRef.name, resolvedVia: 'phase0' })
        }
      }
    } catch {
      // Skip if can't fetch target workflow
    }
  }

  // Data tables API for remaining
  let dataTablesApiAvailable = false
  let targetDtMap = new Map<string, string>() // name -> id

  try {
    const targetDts = await targetApi.listDataTables()
    dataTablesApiAvailable = true
    for (const dt of targetDts) {
      targetDtMap.set(dt.name, dt.id)
    }
  } catch {
    dataTablesApiAvailable = false
  }

  // Check all workflows for unmatched data tables
  for (const d of discovered) {
    const dtRefs = extractDataTableRefs(d.workflow.nodes || [])
    for (const dtRef of dtRefs) {
      if (matchedDtNames.has(dtRef.name)) continue

      if (dataTablesApiAvailable && targetDtMap.has(dtRef.name)) {
        matchedDtNames.add(dtRef.name)
        matchedDataTables.push({ name: dtRef.name, resolvedVia: 'api' })
      } else {
        if (!missingDataTableMap.has(dtRef.name)) {
          missingDataTableMap.set(dtRef.name, { name: dtRef.name, usedByWorkflows: [] })
        }
        const entry = missingDataTableMap.get(dtRef.name)!
        if (!entry.usedByWorkflows.includes(d.workflow.name)) {
          entry.usedByWorkflows.push(d.workflow.name)
        }
      }
    }
  }

  // Remove from missing if matched
  for (const name of matchedDtNames) {
    missingDataTableMap.delete(name)
  }

  // Tag analysis
  const matchedTags: MigrateAnalysis['matchedTags'] = []
  const createdTags: MigrateAnalysis['createdTags'] = []
  let tagsApiAvailable = false

  // Collect all unique tag names from discovered workflows
  const allTagNames = new Set<string>()
  for (const d of discovered) {
    for (const tag of d.workflow.tags || []) {
      allTagNames.add(tag.name)
    }
  }

  if (allTagNames.size > 0) {
    try {
      const targetTags = await targetApi.listTags()
      tagsApiAvailable = true
      const targetTagNames = new Set(targetTags.map(t => t.name))

      for (const name of allTagNames) {
        if (targetTagNames.has(name)) {
          matchedTags.push({ name })
        } else {
          createdTags.push({ name })
        }
      }
    } catch {
      tagsApiAvailable = false
    }
  }

  return {
    selectedWorkflows,
    additionalSubworkflows,
    existingWorkflows,
    newWorkflows,
    matchedCredentials,
    missingCredentials: Array.from(missingCredMap.values()),
    credentialsApiAvailable,
    matchedDataTables,
    missingDataTables: Array.from(missingDataTableMap.values()),
    dataTablesApiAvailable,
    matchedTags,
    createdTags,
    tagsApiAvailable,
    dynamicReferences,
    brokenReferences,
  }
}

router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const body = req.body as MigrateRequest
    const analysis = await runAnalysis(body)
    res.json({ success: true, data: analysis })
  } catch (e) {
    console.error('[Migrate] Analysis error:', e)
    res.status(500).json({ success: false, error: (e as Error).message })
  }
})

router.post('/execute', async (req: Request, res: Response) => {
  try {
    const body = req.body as MigrateRequest
    const sourceInstance = await instanceStore.getInstanceById(body.sourceInstanceId)
    const targetInstance = await instanceStore.getInstanceById(body.targetInstanceId)
    if (!sourceInstance || !targetInstance) throw new Error('Instance not found')

    const sourceApi = new N8nApiService(sourceInstance)
    const targetApi = new N8nApiService(targetInstance)

    // Re-run discovery
    const visited = new Set<string>()
    const discovered: DiscoveryResult[] = []
    const dynamicRefs: MigrateAnalysis['dynamicReferences'] = []
    const brokenRefs: MigrateAnalysis['brokenReferences'] = []

    for (const wfId of body.workflowIds) {
      await discoverDependencies(sourceApi, wfId, visited, null, discovered, dynamicRefs, brokenRefs)
    }

    const allWorkflows = discovered.map(d => d.workflow)

    // Build target name->workflow map
    const targetWorkflows = await targetApi.listAllWorkflows()
    const targetByName = new Map<string, WorkflowListItem>()
    for (const tw of targetWorkflows) {
      targetByName.set(tw.name, tw)
    }

    // Build credential map from API
    let targetCredMap = new Map<string, string>()
    try {
      const targetCreds = await targetApi.listCredentials()
      for (const c of targetCreds) {
        targetCredMap.set(`${c.type}::${c.name}`, c.id)
      }
    } catch {
      // Credentials API not available
    }

    // Build data table map from API (name -> target id)
    let targetDtMap = new Map<string, string>()
    try {
      const targetDts = await targetApi.listDataTables()
      for (const dt of targetDts) {
        targetDtMap.set(dt.name, dt.id)
      }
    } catch {
      // Data tables API not available
    }

    // Build tag name -> target ID map, auto-creating missing tags
    const targetTagMap = new Map<string, string>() // name -> targetId
    try {
      const targetTags = await targetApi.listTags()
      for (const t of targetTags) {
        targetTagMap.set(t.name, t.id)
      }

      // Collect all tag names from source workflows
      const neededTagNames = new Set<string>()
      for (const wf of allWorkflows) {
        for (const tag of wf.tags || []) {
          neededTagNames.add(tag.name)
        }
      }

      // Create any missing tags on target
      for (const name of neededTagNames) {
        if (!targetTagMap.has(name)) {
          try {
            const created = await targetApi.createTag(name)
            targetTagMap.set(name, created.id)
          } catch {
            // Best effort — skip if tag creation fails
          }
        }
      }
    } catch {
      // Tags API not available — skip tag assignment
    }

    // Pre-populate ID map for existing workflows
    const idMap = new Map<string, string>() // sourceId -> targetId
    for (const wf of allWorkflows) {
      const target = targetByName.get(wf.name)
      if (target) {
        idMap.set(wf.id, target.id)
      }
    }

    // Topological sort (leaves first)
    const sorted = topoSort(allWorkflows, getChildWorkflowIds)

    const results: MigrateResult[] = []

    for (const workflow of sorted) {
      try {
        // Re-fetch full workflow from source (fresh copy for modifications)
        const sourceWf = await sourceApi.getWorkflow(workflow.id)
        const nodes = sourceWf.nodes || []

        // Rewrite subworkflow references
        rewriteWorkflowRefs(nodes, idMap)

        // Credential and data table resolution
        const existingTarget = targetByName.get(sourceWf.name)
        if (existingTarget) {
          // Phase 0 — copy credentials and data tables from existing target workflow
          try {
            const targetWf = await targetApi.getWorkflow(existingTarget.id)
            applyPhase0Credentials(nodes, targetWf.nodes || [])
            applyPhase0DataTables(nodes, targetWf.nodes || [])
          } catch {
            // Fall through to API-based matching
          }
        }

        // API-based credential matching for any remaining
        if (targetCredMap.size > 0) {
          applyCredentialsApi(nodes, targetCredMap)
        }

        // API-based data table rewriting
        if (targetDtMap.size > 0) {
          // Build source-id -> target-id map from name matching
          const dtIdMap = new Map<string, string>()
          for (const node of nodes) {
            const ref = extractDataTableRef(node)
            if (!ref) continue
            const targetId = targetDtMap.get(ref.name)
            if (targetId && !dtIdMap.has(ref.id)) {
              dtIdMap.set(ref.id, targetId)
            }
          }
          rewriteDataTableRefs(nodes, dtIdMap)
        }

        // Scrub metadata
        const deployBody = scrubForDeploy(sourceWf)
        deployBody.nodes = nodes
        deployBody.connections = sourceWf.connections

        let targetId: string | undefined
        if (existingTarget) {
          // Deactivate if active, then update
          if (existingTarget.active) {
            try {
              await targetApi.updateWorkflow(existingTarget.id, { active: false } as Partial<N8nWorkflow>)
            } catch {
              // Continue even if deactivation fails
            }
          }
          const updated = await targetApi.updateWorkflow(existingTarget.id, deployBody as Partial<N8nWorkflow>)
          idMap.set(workflow.id, updated.id)
          targetId = updated.id
          results.push({
            workflowId: workflow.id,
            workflowName: workflow.name,
            sourceId: workflow.id,
            status: 'updated',
            targetId: updated.id,
          })
        } else {
          // Create new workflow
          const created = await targetApi.createWorkflow(
            deployBody as Partial<N8nWorkflow>,
            body.targetProjectId
          )
          idMap.set(workflow.id, created.id)
          targetId = created.id
          results.push({
            workflowId: workflow.id,
            workflowName: workflow.name,
            sourceId: workflow.id,
            status: 'created',
            targetId: created.id,
          })
        }

        // Assign tags to the target workflow (best-effort)
        if (targetId && targetTagMap.size > 0 && sourceWf.tags?.length) {
          try {
            const tagIds = sourceWf.tags
              .map(t => targetTagMap.get(t.name))
              .filter((id): id is string => !!id)
            if (tagIds.length > 0) {
              await targetApi.setWorkflowTags(targetId, tagIds)
            }
          } catch {
            // Best effort — don't fail the workflow migration for tags
          }
        }
      } catch (e) {
        console.error(`[Migrate] Error migrating workflow ${workflow.name}:`, e)
        results.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
          sourceId: workflow.id,
          status: 'error',
          error: (e as Error).message,
        })
      }
    }

    res.json({ success: true, data: results })
  } catch (e) {
    console.error('[Migrate] Execution error:', e)
    res.status(500).json({ success: false, error: (e as Error).message })
  }
})

export default router

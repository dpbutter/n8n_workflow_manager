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

function scrubForDeploy(workflow: N8nWorkflow): Record<string, unknown> {
  const body = { ...workflow } as Record<string, unknown>
  delete body.id
  delete body.active
  delete body.tags
  delete body.createdAt
  delete body.updatedAt
  delete body.versionId
  delete body.isArchived
  if (!body.settings) body.settings = { executionOrder: 'v1' }
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

  return {
    selectedWorkflows,
    additionalSubworkflows,
    existingWorkflows,
    newWorkflows,
    matchedCredentials,
    missingCredentials: Array.from(missingCredMap.values()),
    credentialsApiAvailable,
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

        // Credential resolution
        const existingTarget = targetByName.get(sourceWf.name)
        if (existingTarget) {
          // Tier 1: Phase 0 — copy credentials from existing target workflow
          try {
            const targetWf = await targetApi.getWorkflow(existingTarget.id)
            applyPhase0Credentials(nodes, targetWf.nodes || [])
          } catch {
            // Fall through to Tier 2
          }
        }

        // Tier 2: API-based credential matching for any remaining
        if (targetCredMap.size > 0) {
          applyCredentialsApi(nodes, targetCredMap)
        }

        // Scrub metadata
        const deployBody = scrubForDeploy(sourceWf)
        deployBody.nodes = nodes
        deployBody.connections = sourceWf.connections

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
          results.push({
            workflowId: workflow.id,
            workflowName: workflow.name,
            sourceId: workflow.id,
            status: 'created',
            targetId: created.id,
          })
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

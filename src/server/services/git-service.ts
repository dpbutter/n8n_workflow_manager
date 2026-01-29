import simpleGit, { SimpleGit } from 'simple-git'
import { writeFile, mkdir, readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { GitCommit, N8nWorkflow, WorkflowGitStatus } from '../../shared/types.js'

const DATA_DIR = join(process.cwd(), 'data')
const WORKFLOWS_DIR = join(DATA_DIR, 'workflows')

let git: SimpleGit

function getGit(): SimpleGit {
  if (!git) {
    git = simpleGit(process.cwd())
  }
  return git
}

export async function ensureWorkflowsDir(instanceName: string): Promise<string> {
  const instanceDir = join(WORKFLOWS_DIR, sanitizeName(instanceName))
  if (!existsSync(instanceDir)) {
    await mkdir(instanceDir, { recursive: true })
  }
  return instanceDir
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase()
}

export async function backupWorkflows(
  instanceName: string,
  workflows: N8nWorkflow[],
  message?: string
): Promise<GitCommit> {
  const instanceDir = await ensureWorkflowsDir(instanceName)
  const g = getGit()

  // Write each workflow to a file
  const filePaths: string[] = []
  for (const workflow of workflows) {
    const fileName = `${workflow.id}-${sanitizeName(workflow.name)}.json`
    const filePath = join(instanceDir, fileName)
    await writeFile(filePath, JSON.stringify(workflow, null, 2))
    filePaths.push(filePath)
  }

  // Stage and commit
  await g.add(filePaths)

  const workflowNames = workflows.map(w => w.name).join(', ')
  const commitMessage = message || `Backup ${workflows.length} workflow(s): ${workflowNames}`

  await g.commit(commitMessage)

  const log = await g.log({ maxCount: 1 })
  const latest = log.latest!

  return {
    hash: latest.hash,
    date: latest.date,
    message: latest.message,
    author: latest.author_name
  }
}

export async function getBackupHistory(limit = 20): Promise<GitCommit[]> {
  const g = getGit()

  try {
    const log = await g.log({
      maxCount: limit,
      file: WORKFLOWS_DIR
    })

    return log.all.map(entry => ({
      hash: entry.hash,
      date: entry.date,
      message: entry.message,
      author: entry.author_name
    }))
  } catch {
    return []
  }
}

export async function getFileAtCommit(commitHash: string, filePath: string): Promise<string> {
  const g = getGit()
  return g.show([`${commitHash}:${filePath}`])
}

export async function getWorkflowsGitStatus(
  instanceName: string,
  workflows: Array<{ id: string; updatedAt: string }>
): Promise<WorkflowGitStatus[]> {
  const instanceDir = join(WORKFLOWS_DIR, sanitizeName(instanceName))

  if (!existsSync(instanceDir)) {
    return workflows.map(wf => ({
      workflowId: wf.id,
      hasBackup: false,
      isModified: false
    }))
  }

  const files = await readdir(instanceDir)
  const backupMap = new Map<string, { filePath: string; lastBackupDate: string }>()

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const workflowId = file.split('-')[0]
    const filePath = join(instanceDir, file)

    try {
      const content = await readFile(filePath, 'utf-8')
      const backup = JSON.parse(content) as N8nWorkflow
      backupMap.set(workflowId, {
        filePath,
        lastBackupDate: backup.updatedAt
      })
    } catch {
      // Skip files that can't be parsed
    }
  }

  return workflows.map(wf => {
    const backup = backupMap.get(wf.id)
    if (!backup) {
      return {
        workflowId: wf.id,
        hasBackup: false,
        isModified: false
      }
    }

    const workflowDate = new Date(wf.updatedAt).getTime()
    const backupDate = new Date(backup.lastBackupDate).getTime()

    return {
      workflowId: wf.id,
      hasBackup: true,
      lastBackupDate: backup.lastBackupDate,
      isModified: workflowDate > backupDate
    }
  })
}

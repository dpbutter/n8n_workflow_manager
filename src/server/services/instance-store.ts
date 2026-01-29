import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { v4 as uuid } from 'uuid'
import type { N8nInstance } from '../../shared/types.js'

const DATA_DIR = join(process.cwd(), 'data')
const INSTANCES_FILE = join(DATA_DIR, 'instances.json')

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true })
  }
}

async function readInstances(): Promise<N8nInstance[]> {
  await ensureDataDir()
  if (!existsSync(INSTANCES_FILE)) {
    return []
  }
  const content = await readFile(INSTANCES_FILE, 'utf-8')
  return JSON.parse(content)
}

async function writeInstances(instances: N8nInstance[]): Promise<void> {
  await ensureDataDir()
  await writeFile(INSTANCES_FILE, JSON.stringify(instances, null, 2))
}

export async function getAllInstances(): Promise<N8nInstance[]> {
  return readInstances()
}

export async function getInstanceById(id: string): Promise<N8nInstance | undefined> {
  const instances = await readInstances()
  return instances.find(i => i.id === id)
}

export async function createInstance(data: Omit<N8nInstance, 'id' | 'createdAt'>): Promise<N8nInstance> {
  const instances = await readInstances()
  const newInstance: N8nInstance = {
    ...data,
    id: uuid(),
    createdAt: new Date().toISOString()
  }
  instances.push(newInstance)
  await writeInstances(instances)
  return newInstance
}

export async function updateInstance(id: string, data: Partial<N8nInstance>): Promise<N8nInstance | null> {
  const instances = await readInstances()
  const index = instances.findIndex(i => i.id === id)
  if (index === -1) return null

  instances[index] = { ...instances[index], ...data }
  await writeInstances(instances)
  return instances[index]
}

export async function deleteInstance(id: string): Promise<boolean> {
  const instances = await readInstances()
  const index = instances.findIndex(i => i.id === id)
  if (index === -1) return false

  instances.splice(index, 1)
  await writeInstances(instances)
  return true
}

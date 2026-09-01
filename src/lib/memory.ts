import type { ChatAttachmentKind, Conversation, DocumentAnnotation, DocumentHighlight, StudyProject } from '../types'

export type StoredConversation = Conversation

export type FileMemoryRecord = {
  id: string
  projectId?: string
  fileName: string
  fileSize: number
  fileType: string
  lastModified: number
  updatedAt: number
  conversations: StoredConversation[]
  activeConversationId: string
  currentPage: number
  zoom: number
  areaSelectionEnabled: boolean
  scope: 'general' | 'selection' | 'document' | 'notebook'
  fileBlob?: Blob
  documentText?: string
  documentTextVersion?: number
  note?: string
  noteAssets?: Record<string, string>
  highlights?: DocumentHighlight[]
  annotations?: DocumentAnnotation[]
  openaiFileId?: string
  indexStatus?: 'local' | 'uploading' | 'ready' | 'error'
}

export type ProjectMemoryRecord = StudyProject

export type FileMemorySummary = Pick<FileMemoryRecord, 'id' | 'fileName' | 'fileSize' | 'fileType' | 'lastModified' | 'updatedAt'> & { conversationCount: number }

const databaseName = 'reading-assistant-memory'
const storeName = 'file-memories'
const projectStoreName = 'project-memories'
const conversationAttachmentStoreName = 'conversation-attachments'

export type ConversationAttachmentRecord = {
  id: string
  projectId: string
  conversationId: string
  messageId: string
  name: string
  kind: ChatAttachmentKind
  mimeType: string
  size: number
  lastModified: number
  createdAt: number
  fileBlob: Blob
  preparedText?: string
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 3)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'id' })
      if (!request.result.objectStoreNames.contains(projectStoreName)) request.result.createObjectStore(projectStoreName, { keyPath: 'id' })
      if (!request.result.objectStoreNames.contains(conversationAttachmentStoreName)) {
        const attachmentStore = request.result.createObjectStore(conversationAttachmentStoreName, { keyPath: 'id' })
        attachmentStore.createIndex('conversationId', 'conversationId')
        attachmentStore.createIndex('projectId', 'projectId')
        attachmentStore.createIndex('messageId', 'messageId')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开文件记忆数据库。'))
  })
}

function runRequest<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>, targetStore = storeName) {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(targetStore, mode)
    const request = operation(transaction.objectStore(targetStore))
    let result: T
    request.onsuccess = () => { result = request.result }
    request.onerror = () => reject(request.error || new Error('文件记忆操作失败。'))
    transaction.oncomplete = () => { database.close(); resolve(result) }
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error('文件记忆事务失败。')) }
    transaction.onabort = () => { database.close(); reject(transaction.error || new Error('文件记忆事务已中止。')) }
  }))
}

export function getFileMemoryId(file: File, projectId = '') {
  return JSON.stringify([projectId, file.name, file.size, file.lastModified, file.type])
}

export function getFileMemory(id: string) {
  return runRequest<FileMemoryRecord | undefined>('readonly', (store) => store.get(id))
}

export function saveFileMemory(record: FileMemoryRecord) {
  return runRequest<IDBValidKey>('readwrite', (store) => store.put(record))
}

export function deleteFileMemory(id: string) {
  return runRequest<undefined>('readwrite', (store) => store.delete(id))
}

export function listFileMemoryRecords() {
  return runRequest<FileMemoryRecord[]>('readonly', (store) => store.getAll())
}

export async function listFileMemories(): Promise<FileMemorySummary[]> {
  const records = await runRequest<FileMemoryRecord[]>('readonly', (store) => store.getAll())
  return records.sort((a, b) => b.updatedAt - a.updatedAt).map((record) => ({
    id: record.id,
    fileName: record.fileName,
    fileSize: record.fileSize,
    fileType: record.fileType,
    lastModified: record.lastModified,
    updatedAt: record.updatedAt,
    conversationCount: record.conversations.length,
  }))
}

export function saveProjectMemory(record: ProjectMemoryRecord) {
  return runRequest<IDBValidKey>('readwrite', (store) => store.put(record), projectStoreName)
}

export function listProjectMemories() {
  return runRequest<ProjectMemoryRecord[]>('readonly', (store) => store.getAll(), projectStoreName)
}

export function deleteProjectMemory(id: string) {
  return runRequest<undefined>('readwrite', (store) => store.delete(id), projectStoreName)
}

export function saveConversationAttachment(record: ConversationAttachmentRecord) {
  return runRequest<IDBValidKey>('readwrite', (store) => store.put(record), conversationAttachmentStoreName)
}

export function listConversationAttachments(conversationId: string) {
  return runRequest<ConversationAttachmentRecord[]>('readonly', (store) => store.index('conversationId').getAll(conversationId), conversationAttachmentStoreName)
}

export function deleteConversationAttachment(id: string) {
  return runRequest<undefined>('readwrite', (store) => store.delete(id), conversationAttachmentStoreName)
}

async function deleteAttachmentRecords(records: ConversationAttachmentRecord[]) {
  await Promise.all(records.map((record) => deleteConversationAttachment(record.id)))
}

export async function deleteConversationAttachments(conversationId: string) {
  await deleteAttachmentRecords(await listConversationAttachments(conversationId))
}

export async function deleteProjectConversationAttachments(projectId: string) {
  const records = await runRequest<ConversationAttachmentRecord[]>('readonly', (store) => store.index('projectId').getAll(projectId), conversationAttachmentStoreName)
  await deleteAttachmentRecords(records)
}

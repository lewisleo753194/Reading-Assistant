import type { ChatMessage } from '../types'

export type StoredConversation = { id: string; title: string; history: ChatMessage[] }

export type FileMemoryRecord = {
  id: string
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
  scope: 'selection' | 'document'
  fileBlob?: Blob
  documentText?: string
  note?: string
  highlights?: Array<{ id: string; page: number; text: string; color: string }>
}

export type FileMemorySummary = Pick<FileMemoryRecord, 'id' | 'fileName' | 'fileSize' | 'fileType' | 'lastModified' | 'updatedAt'> & { conversationCount: number }

const databaseName = 'reading-assistant-memory'
const storeName = 'file-memories'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开文件记忆数据库。'))
  })
}

function runRequest<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = operation(transaction.objectStore(storeName))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('文件记忆操作失败。'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => database.close()
  }))
}

export function getFileMemoryId(file: File) {
  return JSON.stringify([file.name, file.size, file.lastModified, file.type])
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

export function clearFileMemories() {
  return runRequest<undefined>('readwrite', (store) => store.clear())
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

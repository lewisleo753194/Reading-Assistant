export type SourceFile = {
  name: string
  kind: 'pdf' | 'image'
  url: string
  file: File
}

export type SelectionResult = {
  image: string
  images: string[]
  page: number
  regions: Array<{
    page: number
    region: { left: number; top: number; width: number; height: number }
  }>
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  label?: string
}

export type AiConfig = {
  apiKey: string
  baseUrl: string
  model: string
  visionEnabled: boolean
  visionApiKey: string
  visionBaseUrl: string
  visionModel: string
  reasoningEnabled: boolean
  reasoningApiKey: string
  reasoningBaseUrl: string
  reasoningModel: string
}

import { GlobalWorkerOptions, Util, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export async function loadPdf(url: string): Promise<PDFDocumentProxy> {
  return getDocument({ url }).promise
}

export function getSampledPageNumbers(total: number, maximum: number) {
  if (total <= maximum) return Array.from({ length: total }, (_, index) => index + 1)
  return Array.from(new Set(Array.from({ length: maximum }, (_, index) => Math.round(index * (total - 1) / (maximum - 1)) + 1)))
}

export async function extractPdfText(pdf: PDFDocumentProxy, onProgress?: (done: number, total: number) => void, maximumCharacters = 100000) {
  const pages: string[] = []
  const pageNumbers = getSampledPageNumbers(pdf.numPages, 72)
  let characters = 0
  for (let index = 0; index < pageNumbers.length; index += 1) {
    const pageNumber = pageNumbers[index]
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
    const remaining = Math.max(0, maximumCharacters - characters)
    pages.push(`[第 ${pageNumber} 页]\n${text.slice(0, remaining)}`)
    characters += text.length
    onProgress?.(index + 1, pageNumbers.length)
    page.cleanup()
    if (characters >= maximumCharacters) break
  }
  return pages.join('\n\n')
}

export async function extractPdfRegionText(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  region: { left: number; top: number; width: number; height: number },
) {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const selection = {
    left: region.left * viewport.width,
    top: region.top * viewport.height,
    right: (region.left + region.width) * viewport.width,
    bottom: (region.top + region.height) * viewport.height,
  }

  const lines: Array<{ x: number; y: number; text: string }> = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const transform = Util.transform(viewport.transform, item.transform)
    const x = transform[4]
    const baseline = transform[5]
    const height = Math.max(Math.hypot(transform[2], transform[3]), item.height || 1)
    const width = Math.max(item.width * viewport.scale, 1)
    const box = { left: x, top: baseline - height, right: x + width, bottom: baseline + height * 0.2 }
    const intersects = box.right >= selection.left && box.left <= selection.right && box.bottom >= selection.top && box.top <= selection.bottom
    if (intersects) lines.push({ x, y: baseline, text: item.str })
  }

  lines.sort((a, b) => Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x)
  const output: string[] = []
  let lastY: number | null = null
  for (const item of lines) {
    if (lastY !== null && Math.abs(item.y - lastY) > 3) output.push('\n')
    else if (output.length && output.at(-1) !== '\n') output.push(' ')
    output.push(item.text)
    lastY = item.y
  }
  return output.join('').replace(/\s*\n\s*/g, '\n').trim()
}

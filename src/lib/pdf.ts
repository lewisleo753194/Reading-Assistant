import { GlobalWorkerOptions, Util, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import jbig2WasmUrl from 'pdfjs-dist/wasm/jbig2.wasm?url'
import openjpegWasmUrl from 'pdfjs-dist/wasm/openjpeg.wasm?url'
import qcmsWasmUrl from 'pdfjs-dist/wasm/qcms_bg.wasm?url'
import quickjsWasmUrl from 'pdfjs-dist/wasm/quickjs-eval.wasm?url'

GlobalWorkerOptions.workerSrc = workerUrl

const pdfWasmUrls = [jbig2WasmUrl, openjpegWasmUrl, qcmsWasmUrl, quickjsWasmUrl]
const absolutePdfWasmUrls = pdfWasmUrls.map((url) => new URL(url, window.location.href))
const pdfWasmUrl = new URL('.', absolutePdfWasmUrls[0]).href

if (!absolutePdfWasmUrls.every((url) => new URL('.', url).href === pdfWasmUrl)) {
  throw new Error('PDF 解码资源未打包到同一目录。')
}

export async function loadPdf(url: string): Promise<PDFDocumentProxy> {
  return getDocument({ url, wasmUrl: pdfWasmUrl }).promise
}

export async function extractPdfText(pdf: PDFDocumentProxy, onProgress?: (done: number, total: number) => void, maximumCharacters = Number.POSITIVE_INFINITY, signal?: AbortSignal) {
  const pages: string[] = []
  const pageNumbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1)
  let characters = 0
  for (let index = 0; index < pageNumbers.length; index += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
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

export function parsePdfPageText(text: string) {
  const pages = new Map<number, string>()
  const pattern = /\[第 (\d+) 页\]\n([\s\S]*?)(?=\n\n\[第 \d+ 页\]\n|$)/g
  for (const match of text.matchAll(pattern)) pages.set(Number(match[1]), match[2].trim())
  return pages
}

export function buildPdfPageText(pages: Map<number, string>, totalPages?: number) {
  const pageNumbers = totalPages
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : [...pages.keys()].sort((a, b) => a - b)
  return pageNumbers.map((pageNumber) => `[第 ${pageNumber} 页]\n${pages.get(pageNumber) || ''}`).join('\n\n')
}

export async function renderPdfPageForOcr(pdf: PDFDocumentProxy, pageNumber: number, scale = 1.5) {
  const page = await pdf.getPage(pageNumber)
  try {
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建 PDF OCR 页面画布。')
    await page.render({ canvasContext: context, viewport, canvas }).promise
    return canvas
  } finally {
    page.cleanup()
  }
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

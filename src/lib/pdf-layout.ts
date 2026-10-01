import type { PDFDocumentProxy } from 'pdfjs-dist'

export type PageSize = { width: number; height: number }

// Read geometry only, in bounded batches. No canvases or text layers are retained.
export async function loadPageSizes(pdf: PDFDocumentProxy, isActive: () => boolean) {
  const sizes: Record<number, PageSize> = {}
  for (let first = 1; first <= pdf.numPages; first += 16) {
    if (!isActive()) return null
    await Promise.all(Array.from({ length: Math.min(16, pdf.numPages - first + 1) }, async (_, index) => {
      const pageNumber = first + index
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 0.82 })
      sizes[pageNumber] = { width: viewport.width, height: viewport.height }
    }))
  }
  return isActive() ? sizes : null
}

export const scalePageSize = (size: PageSize, zoom: number): PageSize => ({ width: size.width * zoom, height: size.height * zoom })

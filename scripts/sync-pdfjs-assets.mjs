import { cp, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pdfjsRoot = path.join(projectRoot, 'node_modules', 'pdfjs-dist')
const publicRoot = path.join(projectRoot, 'public', 'pdfjs')
const assetDirectories = ['cmaps', 'standard_fonts']

await mkdir(publicRoot, { recursive: true })
for (const directory of assetDirectories) {
  const source = path.join(pdfjsRoot, directory)
  const destination = path.join(publicRoot, directory)
  await stat(source)
  await mkdir(destination, { recursive: true })
  await cp(source, destination, { recursive: true, force: true })
}

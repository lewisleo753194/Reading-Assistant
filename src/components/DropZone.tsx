import { FileText, Image, Upload } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { useI18n } from '../i18n'

export default function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const accept = (file?: File) => {
    if (file && (file.type === 'application/pdf' || file.type.startsWith('image/'))) onFile(file)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files[0])
  }

  return (
    <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <input ref={inputRef} hidden type="file" accept="application/pdf,image/*" onChange={(e) => accept(e.target.files?.[0])} />
      <div className="drop-icon"><Upload /></div>
      <h2>{t('dropTitle')}</h2>
      <p>{t('dropSubtitle')}</p>
      <button className="primary-button" onClick={() => inputRef.current?.click()}><Upload size={17} /> {t('selectFile')}</button>
      <div className="format-row"><span><FileText size={16} /> PDF 文档</span><span><Image size={16} /> PNG / JPG / WebP</span></div>
    </div>
  )
}

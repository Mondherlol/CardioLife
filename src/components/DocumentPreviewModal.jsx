import { useState, useEffect, useRef } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import {
  X, Download, ZoomIn, ZoomOut, RotateCcw,
  ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react'
import { downloadDoc } from '../api/documents'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

async function fetchBlob(id) {
  const token = localStorage.getItem('token')
  const res   = await fetch(`${API_BASE}/documents/${id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.message || 'Impossible de charger le fichier.')
  }
  return res.blob()
}

/* ── Image viewer inner (needs to be inside TransformWrapper) ── */
function ImageControls() {
  // This component is rendered inside the TransformWrapper render prop
  return null
}

/* ── Main modal ─────────────────────────────────────────────── */
export default function DocumentPreviewModal({ item, siblings = [], onClose }) {
  // siblings = previewable items in current folder
  const [idx, setIdx]         = useState(() => Math.max(0, siblings.findIndex(s => s._id === item._id)))
  const current               = siblings[idx] ?? item

  const [blobUrl, setBlobUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const urlRef                = useRef(null)

  // PDF-specific
  const [numPages, setNumPages] = useState(null)
  const [pageNum,  setPageNum]  = useState(1)
  const [scale,    setScale]    = useState(1.2)

  const isImage = current.mimeType?.startsWith('image/')
  const isPdf   = current.mimeType === 'application/pdf'
  const hasPrev = idx > 0
  const hasNext = idx < siblings.length - 1

  /* ── Fetch blob on item change ─────────────────────────── */
  useEffect(() => {
    let cancelled = false

    // Revoke previous
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }

    setLoading(true)
    setError('')
    setBlobUrl(null)
    setNumPages(null)
    setPageNum(1)

    fetchBlob(current._id)
      .then(blob => {
        if (cancelled) return
        const url     = URL.createObjectURL(blob)
        urlRef.current = url
        setBlobUrl(url)
        setLoading(false)
      })
      .catch(err => {
        if (!cancelled) { setError(err.message); setLoading(false) }
      })

    return () => { cancelled = true }
  }, [current._id])

  // Revoke on unmount
  useEffect(() => {
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }
  }, [])

  /* ── Keyboard shortcuts ────────────────────────────────── */
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowLeft') {
        if (isImage && hasPrev) setIdx(i => i - 1)
        if (isPdf)  setPageNum(p => Math.max(1, p - 1))
      }
      if (e.key === 'ArrowRight') {
        if (isImage && hasNext) setIdx(i => i + 1)
        if (isPdf)  setPageNum(p => Math.min(numPages ?? 1, p + 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isImage, isPdf, hasPrev, hasNext, numPages, onClose])

  /* ── Helpers ───────────────────────────────────────────── */
  function changeScale(delta) {
    setScale(s => +Math.max(0.4, Math.min(4, s + delta)).toFixed(2))
  }

  function handleDownload() {
    downloadDoc(current._id, current.name).catch(() => {})
  }

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div className="pv-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="pv-modal">

        {/* ── Header ── */}
        <div className="pv-header">
          <span className="pv-filename" title={current.name}>{current.name}</span>

          <div className="pv-header-actions">
            {isPdf && (
              <div className="pv-zoom-group">
                <button className="pv-tool" onClick={() => changeScale(-0.25)} title="Dézoomer">
                  <ZoomOut size={14} />
                </button>
                <span className="pv-zoom-label">{Math.round(scale * 100)}%</span>
                <button className="pv-tool" onClick={() => changeScale(+0.25)} title="Zoomer">
                  <ZoomIn size={14} />
                </button>
                <button className="pv-tool" onClick={() => setScale(1.2)} title="Réinitialiser">
                  <RotateCcw size={12} />
                </button>
              </div>
            )}

            <button className="pv-tool" onClick={handleDownload} title="Télécharger">
              <Download size={15} />
            </button>
            <button className="pv-tool pv-tool--close" onClick={onClose} title="Fermer">
              <X size={17} />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className={`pv-body${isImage ? ' pv-body--dark' : ''}`}>

          {loading && (
            <div className="pv-center"><span className="spinner" /></div>
          )}

          {!loading && error && (
            <div className="pv-center pv-error">
              <AlertTriangle size={28} />
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && blobUrl && (
            <>
              {/* Image viewer */}
              {isImage && (
                <TransformWrapper
                  key={current._id}
                  initialScale={1}
                  minScale={0.05}
                  maxScale={16}
                  centerOnInit
                  wheel={{ step: 0.08 }}
                  doubleClick={{ mode: 'zoomIn', step: 1 }}
                >
                  {({ zoomIn, zoomOut, resetTransform }) => (
                    <div className="pv-img-wrap">
                      <div className="pv-img-tools">
                        <button className="pv-float-btn" onClick={() => zoomOut(0.5)}><ZoomOut size={13} /></button>
                        <button className="pv-float-btn" onClick={() => resetTransform()} title="100%"><RotateCcw size={11} /></button>
                        <button className="pv-float-btn" onClick={() => zoomIn(0.5)}><ZoomIn size={13} /></button>
                      </div>
                      <TransformComponent
                        wrapperClass="pv-transform-wrapper"
                        contentClass="pv-transform-content"
                      >
                        <img
                          src={blobUrl}
                          alt={current.name}
                          className="pv-img"
                          draggable={false}
                          onLoad={e => {
                            // If image is very wide or tall, fit to container
                          }}
                        />
                      </TransformComponent>
                    </div>
                  )}
                </TransformWrapper>
              )}

              {/* PDF viewer */}
              {isPdf && (
                <div className="pv-pdf-scroll">
                  <Document
                    file={blobUrl}
                    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                    loading={<div className="pv-center"><span className="spinner" /></div>}
                    error={<div className="pv-center pv-error"><AlertTriangle size={22} /><p>Impossible de charger le PDF.</p></div>}
                  >
                    <Page
                      pageNumber={pageNum}
                      scale={scale}
                      renderAnnotationLayer
                      renderTextLayer
                      className="pv-pdf-page"
                    />
                  </Document>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── PDF page navigation (bottom bar) ── */}
        {isPdf && numPages && (
          <div className="pv-pdf-bar">
            <button className="pv-tool" disabled={pageNum <= 1} onClick={() => setPageNum(p => p - 1)}>
              <ChevronLeft size={15} />
            </button>
            <span className="pv-page-info">
              Page&nbsp;
              <input
                type="number"
                className="pv-page-input"
                value={pageNum}
                min={1}
                max={numPages}
                onChange={e => {
                  const n = parseInt(e.target.value, 10)
                  if (!isNaN(n) && n >= 1 && n <= numPages) setPageNum(n)
                }}
              />
              &nbsp;sur {numPages}
            </span>
            <button className="pv-tool" disabled={pageNum >= numPages} onClick={() => setPageNum(p => p + 1)}>
              <ChevronRight size={15} />
            </button>
          </div>
        )}

        {/* ── Image navigation arrows ── */}
        {isImage && siblings.length > 1 && (
          <>
            <button
              className={`pv-nav-arrow pv-nav-arrow--left${!hasPrev ? ' pv-nav-arrow--hidden' : ''}`}
              onClick={() => setIdx(i => i - 1)}
              disabled={!hasPrev}
            >
              <ChevronLeft size={26} />
            </button>
            <button
              className={`pv-nav-arrow pv-nav-arrow--right${!hasNext ? ' pv-nav-arrow--hidden' : ''}`}
              onClick={() => setIdx(i => i + 1)}
              disabled={!hasNext}
            >
              <ChevronRight size={26} />
            </button>
            <div className="pv-img-counter">
              {idx + 1} / {siblings.length}
            </div>
          </>
        )}

      </div>
    </div>
  )
}

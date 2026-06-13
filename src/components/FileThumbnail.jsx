import { useState, useEffect, useRef } from 'react'
import { Document, Page } from 'react-pdf'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

/* ── Intersection observer hook ─────────────── */
function useInView(ref) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible(true) },
      { threshold: 0.05, rootMargin: '80px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return visible
}

/* ── Fetch file as blob URL ─────────────────── */
function useBlobUrl(id, enabled) {
  const [url, setUrl] = useState(null)
  const urlRef = useRef(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const token = localStorage.getItem('token')
    fetch(`${API_BASE}/documents/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.blob() : null))
      .then(blob => {
        if (!blob || cancelled) return
        const u = URL.createObjectURL(blob)
        urlRef.current = u
        setUrl(u)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
    }
  }, [id, enabled])

  return url
}

/* ── Image thumbnail ────────────────────────── */
export function ImageThumbnail({ id }) {
  const ref    = useRef(null)
  const inView = useInView(ref)
  const url    = useBlobUrl(id, inView)

  return (
    <div ref={ref} className="ft-thumb">
      {url
        ? <img src={url} alt="" className="ft-thumb-img" />
        : <div className="ft-thumb-skeleton" />
      }
    </div>
  )
}

/* ── PDF first-page thumbnail ───────────────── */
export function PdfThumbnail({ id }) {
  const ref    = useRef(null)
  const inView = useInView(ref)
  const url    = useBlobUrl(id, inView)

  return (
    <div ref={ref} className="ft-thumb ft-thumb--pdf">
      {url ? (
        <Document file={url} loading={null} error={null} className="ft-pdf-doc">
          <Page
            pageNumber={1}
            width={120}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            className="ft-pdf-page"
          />
        </Document>
      ) : (
        <div className="ft-thumb-skeleton" />
      )}
    </div>
  )
}

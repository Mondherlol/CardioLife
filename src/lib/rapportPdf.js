import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { getIntervention, uploadRapportPdf } from '../api/interventions'
import { RapportDocument } from '../pages/InterventionPrintPage'

/** Attend que les images du rapport soient chargées (ou en échec) : html2canvas
    capture l'écran tel quel, une photo encore en route sortirait blanche. */
function imagesReady(root) {
  const imgs = [...root.querySelectorAll('img')]
  return Promise.all(imgs.map(img => (img.complete
    ? null
    : new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true })
        img.addEventListener('error', resolve, { once: true })
        setTimeout(resolve, 15000)
      }))))
}

/**
 * Produit le rapport d'intervention en PDF et le range dans les documents du
 * client. Le rendu est celui de la page d'impression, monté hors écran le temps
 * de la capture.
 *
 * Renvoie le Document créé (ou remplacé) côté serveur.
 */
export async function archiveRapportPdf(interventionId) {
  const iv = await getIntervention(interventionId)

  const host = document.createElement('div')
  host.className = 'pr-export-host'
  document.body.appendChild(host)
  const root = createRoot(host)

  try {
    flushSync(() => root.render(createElement(RapportDocument, { iv })))
    await imagesReady(host)

    // Chargée à la demande, comme pour le bon : la bibliothèque est lourde.
    const { default: html2pdf } = await import('html2pdf.js')
    const blob = await html2pdf().set({
      margin:      [8, 0, 8, 0],
      image:       { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:   { mode: ['css', 'legacy'], avoid: ['tr', '.pr-note-box', '.pr-photo', '.pr-table'] },
    }).from(host.firstElementChild).outputPdf('blob')

    const { document: doc } = await uploadRapportPdf(interventionId, blob, 'rapport.pdf')
    return doc
  } finally {
    root.unmount()
    host.remove()
  }
}

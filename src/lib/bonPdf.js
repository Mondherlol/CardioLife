/**
 * PDF du bon d'intervention — source unique de « Imprimer » et « Télécharger ».
 *
 * Les deux boutons suivaient deux chemins : l'impression du navigateur (feuille
 * de style d'impression, marges et échelle de l'imprimante, règles « petit
 * écran » déclenchées par la largeur d'une feuille A4) et une capture d'écran
 * pour le PDF. Le même bon sortait avec deux mises en page. Désormais on
 * produit toujours ce PDF, à géométrie A4 fixe, et l'impression l'imprime tel
 * quel : papier et fichier sont identiques.
 */

// Largeur de rendu imposée à la capture : au-dessus du seuil « petit écran »,
// pour qu'une tablette produise le même bon qu'un ordinateur.
const RENDER_WIDTH = 1200

const PDF_OPTIONS = {
  margin:      0,
  image:       { type: 'jpeg', quality: 0.98 },
  html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: RENDER_WIDTH },
  jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
}

/* Copie d'une page à la géométrie d'une feuille A4 : l'écran (ombre, marges
   d'affichage, largeur de la fenêtre) ne doit rien changer au document. */
function exportCopy(page) {
  const clone = page.cloneNode(true)
  clone.classList.add('bi-page--export')
  return clone
}

/**
 * PDF (Blob) d'une ou plusieurs pages `.bi-page`, une feuille A4 par page.
 *
 * Chaque page est capturée à part puis ajoutée au même PDF : capturer toute
 * une semaine d'un coup dépasserait la taille maximale d'un canevas.
 */
export async function bonPdfBlob(pages) {
  const list = Array.isArray(pages) ? pages : [pages]
  // Chargée à la demande : la bibliothèque pèse plus lourd que la page.
  const { default: html2pdf } = await import('html2pdf.js')
  let worker = html2pdf().set(PDF_OPTIONS).from(exportCopy(list[0])).toPdf()
  for (const page of list.slice(1)) {
    worker = worker.get('pdf').then(pdf => pdf.addPage())
      .from(exportCopy(page)).toContainer().toCanvas().toPdf()
  }
  return worker.outputPdf('blob')
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/**
 * Imprime le PDF lui-même, via un cadre invisible. Là où le navigateur ne sait
 * pas imprimer un PDF intégré (certains Safari), le PDF s'ouvre dans un onglet
 * d'où on l'imprime.
 */
export function printBlob(blob) {
  const url    = URL.createObjectURL(blob)
  const iframe = document.createElement('iframe')
  iframe.className = 'bi-print-frame'
  iframe.src = url
  const cleanup = () => { iframe.remove(); URL.revokeObjectURL(url) }
  iframe.onload = () => {
    try {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
      // La boîte d'impression est modale dans la plupart des navigateurs ; on
      // laisse tout de même du temps à ceux qui l'ouvrent en différé.
      setTimeout(cleanup, 60000)
    } catch {
      cleanup()
      window.open(URL.createObjectURL(blob), '_blank')
    }
  }
  document.body.appendChild(iframe)
}

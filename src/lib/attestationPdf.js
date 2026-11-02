/**
 * Attestations de formation — d'après le modèle « ATTESTATION Original V-13 ».
 *
 * Le modèle Word se décompose en un fond (motif + cadre vert), le logo, deux
 * ornements et du texte : on reprend les images telles quelles et on réécrit le
 * texte rempli par-dessus, aux mêmes positions. Les coordonnées sont en points
 * PDF (1/72 po), comme dans le modèle : A4 paysage = 841,92 × 595,2 pt.
 *
 * Un PDF unique, une page par personne formée.
 */

const ASSETS = '/attestation'
const GREEN  = '#acb934'
const INK    = '#201c20'
const FONT   = "'Titillium Web', Tahoma, 'Segoe UI', sans-serif"

const PDF_OPTIONS = {
  margin:      0,
  image:       { type: 'jpeg', quality: 0.96 },
  html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
  jsPDF:       { unit: 'pt', format: 'a4', orientation: 'landscape' },
}

/** « Mme » ou « Mr », comme sur le modèle. */
export const CIVILITIES = ['Mme', 'Mr']

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

export function fmtAttestationDate(d) {
  if (!d) return ''
  const date = new Date(d.length === 10 ? `${d}T12:00:00` : d)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/* Ligne de texte centrée sur la page, posée par le haut de sa boîte. */
function line(top, size, html, extra = '') {
  return `<div style="position:absolute;left:0;right:0;top:${top}pt;text-align:center;
    font-size:${size}pt;line-height:1.25;${extra}">${html}</div>`
}

/**
 * Une page d'attestation.
 *  person    { civility: 'Mme' | 'Mr', name }
 *  device    modèle du DAE (« POWERHEART G3 Elite »)
 *  trainer   nom du formateur
 *  date      date affichée (jj/mm/aaaa)
 */
function pageHtml({ person, device, trainer, date }) {
  const civ       = person.civility === 'Mr' ? 'Mr' : 'Mme'
  const interesse = civ === 'Mr' ? "l'intéressé" : "l'intéressée"
  const dae       = device ? ` ${esc(device)}` : ''

  return `
  <div style="position:relative;width:841.92pt;height:595pt;overflow:hidden;background:#fff;
      font-family:${FONT};color:${INK};">
    <img src="${ASSETS}/fond.png" style="position:absolute;left:0;top:0;width:841.92pt;height:595.2pt;" />
    <img src="${ASSETS}/logo.png" style="position:absolute;left:377.3pt;top:67.2pt;width:87.4pt;height:69.1pt;" />
    <img src="${ASSETS}/ornement-gauche.png" style="position:absolute;left:334.1pt;top:537.6pt;width:70.1pt;height:36.5pt;" />
    <img src="${ASSETS}/ornement-droit.png" style="position:absolute;left:437.8pt;top:537.6pt;width:70.1pt;height:36.5pt;" />

    ${line(146, 37, 'ATTESTATION', `font-weight:700;color:${GREEN};letter-spacing:.5pt;`)}
    ${line(206, 19.5, 'La société CARDIOLIFE atteste que')}
    ${line(272, 22, `${civ} <span style="font-weight:700;">${esc(person.name)}</span>`)}

    <div style="position:absolute;left:60pt;right:60pt;top:312pt;text-align:center;
        font-size:17.5pt;line-height:23pt;">
      a suivi une formation pratique sur l'utilisation du<br/>
      défibrillateur cardiaque${dae}.<br/>
      Cette attestation est délivrée à ${interesse} pour faire valoir ce que de droit.<br/>
      Date&nbsp;: ${esc(date)}
    </div>

    <div style="position:absolute;left:560pt;width:240pt;top:452pt;text-align:center;line-height:1.25;">
      <div style="font-size:15.5pt;">Le formateur</div>
      <div style="font-size:16pt;font-weight:700;">${esc(trainer)}</div>
    </div>
  </div>`
}

async function ready(el) {
  try {
    await Promise.all([
      document.fonts?.load(`400 16pt 'Titillium Web'`),
      document.fonts?.load(`700 16pt 'Titillium Web'`),
    ])
  } catch { /* police de repli */ }
  await Promise.all([...el.querySelectorAll('img')].map(img =>
    img.complete ? null : new Promise(r => { img.onload = r; img.onerror = r })))
}

function build(data) {
  const el = document.createElement('div')
  el.innerHTML = pageHtml(data)
  return el.firstElementChild
}

/**
 * PDF (Blob) des attestations, une page par personne.
 *  people   [{ civility, name }]
 *  common   { device, trainer, date }
 */
export async function attestationsPdfBlob(people, common) {
  const { default: html2pdf } = await import('html2pdf.js')
  const pages = people.map(person => build({ ...common, person }))

  // Les images et la police doivent être chargées avant la capture.
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;'
  pages.forEach(p => host.appendChild(p))
  document.body.appendChild(host)
  try {
    await ready(host)
    let worker = html2pdf().set(PDF_OPTIONS).from(pages[0]).toPdf()
    for (const page of pages.slice(1)) {
      worker = worker.get('pdf').then(pdf => pdf.addPage('a4', 'landscape'))
        .from(page).toContainer().toCanvas().toPdf()
    }
    return await worker.outputPdf('blob')
  } finally {
    host.remove()
  }
}

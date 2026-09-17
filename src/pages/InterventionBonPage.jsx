import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Download, Printer, RotateCcw } from 'lucide-react'
import { toast } from 'react-toastify'
import { getIntervention, saveBon } from '../api/interventions'
import { getAppSettings, companyLogoUrl } from '../api/appSettings'

/* Identité de repli : le document doit s'imprimer même si les paramètres ne
   répondent pas — un technicien sur site n'a pas de seconde chance. */
const FALLBACK_COMPANY = {
  name:    'CARDIO life',
  address: 'Avenue 18 Janvier 1952\nAriana Centre 2ème Etage',
  city:    "2080 L'ARIANA",
  phone:   '71 714 063 – 31 119 719\n27 629 217 – 53 629 529',
  email:   'info@cardiolife.tn',
  website: 'www.cardiolife.tn',
  taxId:   '1446928Z/B/M/000',
  footer:  "BUREAU : Av 18 Janvier 1952 Centre Ariana 2ème Etage B.208A - L'ARIANA CP Ville 2080\nMF : 000/M/B/1446928/Z – BIAT 08 307 0005910015690 80",
}

/**
 * Natures d'intervention, dans l'ordre où le client les lit.
 *
 * `designation` est la phrase telle qu'elle s'écrit dans le tableau du bon
 * papier ; `label` est la même chose, en court, pour le sélecteur d'écran.
 */
const NATURES = [
  { id: 'controle_semestriel',       label: 'Contrôle technique semestriel',
    designation: 'Contrôle technique semestriel du défibrillateur cardiaque' },
  { id: 'controle_annuel',           label: 'Contrôle technique annuel',
    designation: 'Contrôle technique annuel du défibrillateur cardiaque' },
  { id: 'remplacement_consommables', label: 'Remplacement des consommables',
    designation: 'Remplacement des consommables du défibrillateur cardiaque' },
  { id: 'installation',              label: 'Installation',
    designation: 'Installation du défibrillateur cardiaque' },
  { id: 'formation',                 label: 'Formation',
    designation: "Formation à l'utilisation du défibrillateur cardiaque" },
  { id: 'hors_delai',                label: 'Intervention hors délai du contrôle technique',
    designation: 'Intervention hors délai du contrôle technique sur le défibrillateur cardiaque' },
]

/* Nature proposée d'après ce que la visite dit d'elle-même : un contrôle
   semestriel du contrat n'a pas à être requalifié à la main. */
function suggestNature(iv) {
  if (iv?.controlType === 'semestriel') return ['controle_semestriel']
  if (iv?.controlType === 'annuel')     return ['controle_annuel']
  return []
}

/* Les anciens bons stockaient une seule nature en texte. */
function savedNatures(bon) {
  const n = bon?.nature
  return (Array.isArray(n) ? n : [n]).filter(Boolean)
}

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR')
}

/* Adresse, téléphones, pied de page : saisis en texte libre dans les
   paramètres, rendus ligne à ligne comme sur le papier à en-tête. */
function Lines({ text, className }) {
  const lines = String(text || '').split('\n').filter(l => l.trim())
  if (!lines.length) return null
  return <>{lines.map((l, i) => <div key={i} className={className}>{l}</div>)}</>
}

/**
 * Bon d'intervention — le document que le client signe en fin de visite.
 *
 * Il reprend la mise en page du bon papier de l'entreprise : en-tête à gauche,
 * client et référence en tête, une ligne de désignation par appareil, et le
 * cartouche « Date de réception et visa / Observation » que le client tamponne.
 * Il ne reprend pas la checklist : il atteste du passage et de sa nature.
 *
 * Référence, nature et signataire sont enregistrés sur l'intervention : un bon
 * réimprimé six mois plus tard doit dire exactement la même chose.
 */
export default function InterventionBonPage() {
  const { id } = useParams()
  const [iv,      setIv]      = useState(null)
  const [company, setCompany] = useState(FALLBACK_COMPANY)
  const [error,   setError]   = useState(false)
  const [ref,     setRef]     = useState('')
  const [bc,      setBc]      = useState('')
  const [natures, setNatures] = useState([])
  const [signer,  setSigner]  = useState('')
  // Désignations retouchées, par ligne (« <nature>|<appareil> »).
  const [custom,  setCustom]  = useState({})
  const [saving,  setSaving]  = useState(false)
  const [dl,      setDl]      = useState(false)

  useEffect(() => {
    getIntervention(id)
      .then(data => {
        setIv(data)
        setRef(data.bon?.reference || '')
        setBc(data.bon?.bonCommande || '')
        const saved = savedNatures(data.bon)
        setNatures(saved.length ? saved : suggestNature(data))
        setSigner(data.bon?.signataire || data.visite?.visa || '')
        setCustom(data.bon?.designations || {})
      })
      .catch(() => setError(true))
  }, [id])

  useEffect(() => {
    getAppSettings()
      .then(s => s?.company && setCompany({ ...FALLBACK_COMPANY, ...s.company }))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (iv) document.title = `Bon d'intervention — ${iv.clientName || id}`
  }, [iv, id])

  async function save() {
    setSaving(true)
    try {
      // Seules les lignes réellement modifiées sont gardées : un texte identique
      // au libellé par défaut suivra les évolutions de ce dernier.
      const autoOf = Object.fromEntries(lines.map(l => [l.key, l.auto]))
      const designations = Object.fromEntries(Object.entries(custom)
        .filter(([k, v]) => autoOf[k] !== undefined && v.trim() && v.trim() !== autoOf[k]))
      await saveBon(id, {
        reference: ref, bonCommande: bc, nature: natures, signataire: signer, designations,
      })
      toast.success('Bon enregistré.')
    } catch (err) {
      toast.error(err.message || 'Enregistrement impossible.')
    } finally {
      setSaving(false)
    }
  }

  /* Téléchargement direct : le client attend son bon, pas une boîte de dialogue
     d'impression où il faut encore choisir « Enregistrer au format PDF ». */
  async function download() {
    const page = document.querySelector('.bi-page')
    if (!page) return
    setDl(true)
    try {
      /* Chargée à la demande : la bibliothèque pèse plus lourd que la page
         elle-même, et neuf visites sur dix s'impriment sans jamais l'appeler. */
      const { default: html2pdf } = await import('html2pdf.js')
      const who  = (iv.clientName || 'client').replace(/[\/:*?"<>|]/g, '-')
      const when = new Date(iv.completedDate || iv.scheduledDate || Date.now())
        .toLocaleDateString('fr-FR').replace(/\//g, '-')
      await html2pdf().set({
        filename: `Bon d'intervention - ${who} - ${when}.pdf`,
        margin:   0,
        image:    { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF:    { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(page).save()
    } catch {
      toast.error('Téléchargement impossible — utilisez « Imprimer ».')
    } finally {
      setDl(false)
    }
  }

  function toggleNature(nid) {
    setNatures(cur => cur.includes(nid) ? cur.filter(n => n !== nid) : [...cur, nid])
  }

  if (error) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Intervention introuvable.</div>
  if (!iv)   return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Chargement…</div>

  const snap   = iv.installationSnap || {}
  const fiches = (iv.fiches?.length ? iv.fiches : [iv.fiche || {}])

  /* Un bon porte l'appareil concerné : le parc le nomme mieux que la checklist,
     qui ne ressaisit que ce que le technicien a corrigé sur place. */
  const deaOf = f => (iv.siteDeas || []).find(d => String(d._id) === String(f.dea))
  const devices = fiches.map(f => {
    const dea = deaOf(f)
    return {
      key:    String(f.dea || 'unique'),
      model:  dea?.deviceType || f.deaLabel || snap.deviceType || 'DAE',
      serial: f.serialNumber || dea?.serialNumber || snap.serialNumber || '',
    }
  })

  const dateVisite  = iv.completedDate || iv.scheduledDate
  /* Ordre du bon papier, quel que soit l'ordre des coches. */
  const chosen       = NATURES.filter(n => natures.includes(n.id))
  const designations = chosen.length
    ? chosen.map(n => ({ id: n.id, text: n.designation }))
    : [{ id: 'defaut', text: 'Intervention sur le défibrillateur cardiaque' }]
  /* Une ligne par nature et par appareil. Le texte proposé se remplace à la
     main quand le libellé type ne colle pas à ce qui a été fait. */
  const lines = designations.flatMap(n => devices.map(d => {
    const key  = `${n.id}|${d.key}`
    const auto = `${n.text} ${d.model}`
    return { key, auto, text: custom[key]?.trim() ? custom[key] : auto, serial: d.serial }
  }))
  const site       = iv.siteName || iv.site?.name
  const website     = String(company.website || '').replace(/^https?:\/\//, '')

  return (
    <div className="bi-wrap">
      {/* ── Barre d'écran : ce qui se règle avant d'imprimer ── */}
      <div className="bi-bar no-print">
        <div className="bi-bar-group bi-bar-group--sm">
          <label className="bi-bar-label">Référence</label>
          <input className="form-input form-input--plain" value={ref}
            onChange={e => setRef(e.target.value)} placeholder="352/2025" />
        </div>

        <div className="bi-bar-group bi-bar-group--sm">
          <label className="bi-bar-label">BC</label>
          <input className="form-input form-input--plain" value={bc}
            onChange={e => setBc(e.target.value)} placeholder="N° bon de commande" />
        </div>

        <div className="bi-bar-group">
          <label className="bi-bar-label">Nom du signataire</label>
          <input className="form-input form-input--plain" value={signer}
            onChange={e => setSigner(e.target.value)}
            placeholder="Responsable du site" />
        </div>

        <div className="bi-bar-group bi-bar-group--full">
          <span className="bi-bar-label">Nature de l'intervention</span>
          <div className="bi-natures">
            {NATURES.map(n => {
              const on = natures.includes(n.id)
              return (
                <label key={n.id} className={`bi-nature${on ? ' bi-nature--on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleNature(n.id)} />
                  {n.label}
                </label>
              )
            })}
          </div>
        </div>

        <div className="bi-bar-group bi-bar-group--full">
          <span className="bi-bar-label">Désignation</span>
          <div className="bi-desi-edit">
            {lines.map(l => {
              const edited = l.text !== l.auto
              return (
                <div key={l.key} className="bi-desi-edit-row">
                  <textarea className="form-input form-input--plain" rows={2}
                    value={l.text}
                    onChange={e => setCustom(c => ({ ...c, [l.key]: e.target.value }))} />
                  {edited && (
                    <button type="button" className="btn btn--ghost btn--sm"
                      title="Revenir au texte par défaut"
                      onClick={() => setCustom(c => { const n = { ...c }; delete n[l.key]; return n })}>
                      <RotateCcw size={13} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="bi-bar-actions">
          <button className="btn btn--ghost" onClick={save} disabled={saving}>
            {saving ? <span className="login-btn-spinner" /> : 'Enregistrer'}
          </button>
          <button className="btn btn--ghost" onClick={() => window.print()}>
            <Printer size={14} /> Imprimer
          </button>
          <button className="btn btn--primary" onClick={download} disabled={dl}>
            {dl ? <span className="login-btn-spinner" /> : <><Download size={14} /> Télécharger le PDF</>}
          </button>
        </div>
      </div>

      {/* ── Le document ── */}
      <div className="bi-page">
        {/* En-tête : identité de l'émetteur à gauche, nature du document et
            destinataire à droite — la lecture du bon papier. */}
        <header className="bi-head">
          <div className="bi-issuer">
            <img src={companyLogoUrl(company.logo)} alt={company.name}
              className="bi-logo" crossOrigin="anonymous"
              onError={e => { e.target.src = '/logo-cardiolife.jpg' }} />
            <dl className="bi-issuer-info">
              {company.address && <div><dt>Adresse</dt><dd><Lines text={company.address} /></dd></div>}
              {company.city    && <div><dt>CP Ville</dt><dd>{company.city}</dd></div>}
              {company.phone   && <div><dt>Téléphone</dt><dd><Lines text={company.phone} /></dd></div>}
              {company.email   && <div><dt>E-mail</dt><dd><a href={`mailto:${company.email}`}>{company.email}</a></dd></div>}
              {website         && <div><dt>Site web</dt><dd><a href={`https://${website}`}>{website}</a></dd></div>}
            </dl>
          </div>

          <div className="bi-doc">
            <h1 className="bi-title">Bon d'intervention</h1>
            <div className="bi-recipient">
              <span className="bi-recipient-name">{iv.clientName || '—'}</span>
              {site && <span className="bi-recipient-site">{site}</span>}
            </div>
          </div>
        </header>

        {/* Références du document — colonne de gauche, comme sur le papier. */}
        <section className="bi-meta">
          <div className="bi-meta-line">
            <span className="bi-meta-label">Référence</span>
            <span className="bi-meta-value">{ref || `#${id.slice(-8).toUpperCase()}`}</span>
          </div>
          {bc && (
            <div className="bi-meta-line">
              <span className="bi-meta-label">BC</span>
              <span className="bi-meta-value">{bc}</span>
            </div>
          )}
          <div className="bi-meta-line">
            <span className="bi-meta-label">Date</span>
            <span className="bi-meta-value">{fmt(dateVisite)}</span>
          </div>
          {company.taxId && (
            <div className="bi-meta-line">
              <span className="bi-meta-label">MF</span>
              <span className="bi-meta-value">{company.taxId}</span>
            </div>
          )}
          {(iv.technicienName || iv.technicien?.fullName) && (
            <div className="bi-meta-line">
              <span className="bi-meta-label">Technicien</span>
              <span className="bi-meta-value">{iv.technicienName || iv.technicien?.fullName}</span>
            </div>
          )}
        </section>

        {/* Le corps du bon : une ligne par appareil intervenu. */}
        <table className="bi-table">
          <thead>
            <tr>
              <th className="bi-col-qty">Qté</th>
              <th>Désignation</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.key}>
                <td className="bi-col-qty">1</td>
                <td>
                  <div className="bi-desi">{l.text}</div>
                  {l.serial && <div className="bi-desi-sn">DEA S/N {l.serial}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Le cartouche que le client remplit : c'est lui qui donne sa valeur au
            bon — sans ce visa, rien n'atteste du passage. */}
        <table className="bi-table bi-table--visa">
          <thead>
            <tr>
              <th>Date de réception et visa</th>
              <th>Observation</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="bi-visa-cell">
                {signer && <span className="bi-visa-name">{signer}</span>}
              </td>
              <td className="bi-visa-cell" />
            </tr>
          </tbody>
        </table>

        <footer className="bi-footer">
          <Lines text={company.footer} className="bi-footer-line" />
        </footer>
      </div>
    </div>
  )
}

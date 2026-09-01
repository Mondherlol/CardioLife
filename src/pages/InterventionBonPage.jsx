import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Download, Printer } from 'lucide-react'
import { toast } from 'react-toastify'
import { getIntervention, saveBon } from '../api/interventions'

/* Logo officiel, fond blanc. Servi depuis l'application et non depuis le site :
   le document doit s'imprimer sans dépendre d'un serveur tiers, et la
   conversion en PDF ne peut pas lire une image d'un autre domaine. */
const LOGO_URL      = '/logo-cardiolife.jpg'
const LOGO_FALLBACK = 'https://cardiolife.tn/wp-content/uploads/2024/09/logo-MAJ.jpg'

/**
 * Natures d'intervention, dans l'ordre où le client les lit.
 *
 * Elles sont imprimées toutes les cinq, une seule cochée : un bon signé doit
 * montrer ce qui a été retenu *et* ce qui ne l'a pas été, comme le ferait le
 * formulaire papier qu'il remplace.
 */
const NATURES = [
  { id: 'controle_semestriel',       label: 'Contrôle technique semestriel' },
  { id: 'controle_annuel',           label: 'Contrôle technique annuel' },
  { id: 'remplacement_consommables', label: 'Remplacement des consommables' },
  { id: 'installation',              label: 'Installation' },
  { id: 'hors_delai',                label: 'Intervention hors délai du contrôle technique' },
]

/* Nature proposée d'après ce que la visite dit d'elle-même : un contrôle
   semestriel du contrat n'a pas à être requalifié à la main. */
function suggestNature(iv) {
  if (iv?.controlType === 'semestriel') return 'controle_semestriel'
  if (iv?.controlType === 'annuel')     return 'controle_annuel'
  return ''
}

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function Field({ label, value }) {
  return (
    <div className="bi-field">
      <span className="bi-field-label">{label}</span>
      <span className="bi-field-value">{value || '—'}</span>
    </div>
  )
}

/**
 * Bon d'intervention — le document que le client signe en fin de visite.
 *
 * Il ne reprend pas la checklist : il atteste du passage, de sa nature et du
 * constat du client. Tout tient sur une page A4, sans quoi il ne se signe pas
 * sur le capot d'une voiture.
 *
 * La nature et le signataire sont enregistrés sur l'intervention : un bon
 * réimprimé six mois plus tard doit dire exactement la même chose.
 */
export default function InterventionBonPage() {
  const { id } = useParams()
  const [iv,      setIv]      = useState(null)
  const [error,   setError]   = useState(false)
  const [nature,  setNature]  = useState('')
  const [signer,  setSigner]  = useState('')
  const [saving,  setSaving]  = useState(false)
  const [dl,      setDl]      = useState(false)

  useEffect(() => {
    getIntervention(id)
      .then(data => {
        setIv(data)
        setNature(data.bon?.nature || suggestNature(data))
        setSigner(data.bon?.signataire || data.visite?.visa || '')
      })
      .catch(() => setError(true))
  }, [id])

  useEffect(() => {
    if (iv) document.title = `Bon d'intervention — ${iv.clientName || id}`
  }, [iv, id])

  async function save() {
    setSaving(true)
    try {
      await saveBon(id, { nature, signataire: signer })
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

  const dateVisite = iv.completedDate || iv.scheduledDate

  return (
    <div className="bi-wrap">
      {/* ── Barre d'écran : ce qui se règle avant d'imprimer ── */}
      <div className="bi-bar no-print">
        <div className="bi-bar-group">
          <label className="bi-bar-label">Nature de l'intervention</label>
          <select className="form-input form-input--plain" value={nature}
            onChange={e => setNature(e.target.value)}>
            <option value="">— À préciser —</option>
            {NATURES.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
        </div>

        <div className="bi-bar-group">
          <label className="bi-bar-label">Nom du signataire</label>
          <input className="form-input form-input--plain" value={signer}
            onChange={e => setSigner(e.target.value)}
            placeholder="Responsable du site" />
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
        <header className="bi-header">
          <img src={LOGO_URL} alt="CardioLife" className="bi-logo"
            onError={e => { e.target.src = LOGO_FALLBACK }} />
          <div className="bi-title-block">
            <h1 className="bi-title">Bon d'intervention</h1>
            <p className="bi-ref">Réf. #{id.slice(-8).toUpperCase()}</p>
          </div>
        </header>

        <section className="bi-grid">
          <Field label="Client"      value={iv.clientName} />
          <Field label="Site"        value={iv.siteName || iv.site?.name} />
          <Field label="Date de l'intervention" value={fmt(dateVisite)} />
          <Field label="Technicien"  value={iv.technicienName || iv.technicien?.fullName} />
        </section>

        <section className="bi-section">
          <h2 className="bi-section-title">Appareil{devices.length > 1 ? 's' : ''} concerné{devices.length > 1 ? 's' : ''}</h2>
          <table className="bi-table">
            <thead>
              <tr>
                <th>Modèle de l'appareil</th>
                <th>Numéro de série (SN)</th>
              </tr>
            </thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.key}>
                  <td>{d.model}</td>
                  <td className="bi-mono">{d.serial || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="bi-section">
          <h2 className="bi-section-title">Nature de l'intervention</h2>
          <ul className="bi-natures">
            {NATURES.map(n => (
              <li key={n.id} className={`bi-nature${nature === n.id ? ' bi-nature--on' : ''}`}>
                <span className="bi-box">{nature === n.id ? '×' : ''}</span>
                {n.label}
              </li>
            ))}
          </ul>
        </section>

        {iv.visite?.observationGenerale && (
          <section className="bi-section">
            <h2 className="bi-section-title">Observations</h2>
            <p className="bi-note">{iv.visite.observationGenerale}</p>
          </section>
        )}

        {/* Deux signatures : celle qui engage l'entreprise et celle qui atteste
            du passage. Le bon ne vaut que par la seconde. */}
        <section className="bi-signatures">
          <div className="bi-sign">
            <span className="bi-sign-label">Le technicien</span>
            <span className="bi-sign-name">{iv.technicienName || iv.technicien?.fullName || ''}</span>
            <span className="bi-sign-box" />
          </div>
          <div className="bi-sign">
            <span className="bi-sign-label">Le client — lu et approuvé</span>
            <span className="bi-sign-name">{signer}</span>
            <span className="bi-sign-box" />
          </div>
        </section>

        <footer className="bi-footer">
          CardioLife · Bon d'intervention n° {id.slice(-8).toUpperCase()} ·
          {' '}Établi le {fmt(new Date())}
        </footer>
      </div>
    </div>
  )
}

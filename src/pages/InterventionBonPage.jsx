import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Download, Printer, RotateCcw } from 'lucide-react'
import { toast } from 'react-toastify'
import { getIntervention, saveBon } from '../api/interventions'
import { getFormationBon, saveFormationBon } from '../api/formations'
import { getAppSettings, companyLogoUrl } from '../api/appSettings'

/* Identité de repli : le document doit s'imprimer même si les paramètres ne
   répondent pas — un technicien sur site n'a pas de seconde chance. */
export const FALLBACK_COMPANY = {
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
export function suggestNature(iv) {
  if (iv?.kind === 'formation')         return ['formation']
  if (iv?.controlType === 'semestriel') return ['controle_semestriel']
  if (iv?.controlType === 'annuel')     return ['controle_annuel']
  // Une intervention ponctuelle est, presque toujours, un remplacement.
  if (iv?.controlType === 'intervention') return ['remplacement_consommables']
  return []
}

/* Les anciens bons stockaient une seule nature en texte. */
export function savedNatures(bon) {
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
 * Lignes du tableau du bon : une par nature et par appareil.
 *
 * Les appareils sont ceux des fiches saisies ; une visite pas encore faite
 * (bon imprimé d'avance pour la tournée) n'en a pas, on prend alors les DAE
 * qu'elle vise — l'appareil désigné, sinon tout le parc du site.
 */
export function bonLines(iv, natures, custom = {}) {
  const snap = iv.installationSnap || {}
  const siteDeas = iv.siteDeas || []
  const targets = iv.installation
    ? siteDeas.filter(d => String(d._id) === String(iv.installation))
    : siteDeas
  const fiches = iv.fiches?.length
    ? iv.fiches
    : targets.length
      ? targets.map(d => ({ dea: d._id }))
      : [iv.fiche || {}]

  /* Un bon porte l'appareil concerné : le parc le nomme mieux que la checklist,
     qui ne ressaisit que ce que le technicien a corrigé sur place. Une fiche
     sans appareil (visite d'avant le multi-DAE) se rattache à celui que vise
     la visite, ou au seul DAE du site. */
  const byId  = id => id && siteDeas.find(d => String(d._id) === String(id))
  const deaOf = f => byId(f.dea) || byId(iv.installation)
    || (siteDeas.length === 1 ? siteDeas[0] : null)
  const devices = fiches.map(f => {
    const dea = deaOf(f)
    // `deaLabel` vaut « Modèle · N° de série » : on n'en garde que la part utile.
    const [labelModel, labelSerial] = String(f.deaLabel || '').split(' · ')
    return {
      key:    String(f.dea || 'unique'),
      model:  dea?.deviceType || dea?.product?.name || snap.deviceType
        || (labelModel !== 'Appareil non précisé' ? labelModel : '') || 'DAE',
      serial: f.serialNumber || dea?.serialNumber || snap.serialNumber || labelSerial || '',
    }
  })

  /* Ordre du bon papier, quel que soit l'ordre des coches. */
  const chosen       = NATURES.filter(n => natures.includes(n.id))
  const designations = chosen.length
    ? chosen.map(n => ({ id: n.id, text: n.designation }))
    : [{ id: 'defaut', text: 'Intervention sur le défibrillateur cardiaque' }]
  /* Une ligne par nature et par appareil. Le texte proposé se remplace à la
     main quand le libellé type ne colle pas à ce qui a été fait. */
  return designations.flatMap(n => devices.map(d => {
    const key  = `${n.id}|${d.key}`
    const auto = `${n.text} ${d.model}`
    return {
      key, auto, text: custom[key]?.trim() ? custom[key] : auto,
      model: d.model, serial: d.serial,
    }
  }))
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
/**
 * Une formation lue comme une visite : le bon n'a besoin que du client, du
 * site, de la date, des formateurs et du parc du site.
 */
function formationAsVisit(f) {
  return {
    _id:            f._id,
    kind:           'formation',
    clientName:     f.clientName,
    siteName:       f.site?.name || f.siteName,
    scheduledDate:  f.date,
    technicienName: (f.assignedTo || []).map(u => u.fullName || u.username).filter(Boolean).join(', '),
    siteDeas:       f.siteDeas || [],
    bon:            f.bon,
  }
}

/* Source du bon : une intervention, ou une formation (qui n'a pas de page à
   elle et emprunte donc celle-ci). */
const SOURCES = {
  intervention: { load: getIntervention, save: saveBon, notFound: 'Intervention introuvable.' },
  formation:    {
    load: id => getFormationBon(id).then(formationAsVisit),
    save: saveFormationBon,
    notFound: 'Formation introuvable.',
  },
}

export default function InterventionBonPage({ source = 'intervention' }) {
  const { id } = useParams()
  const src = SOURCES[source]
  const [iv,      setIv]      = useState(null)
  const [company, setCompany] = useState(FALLBACK_COMPANY)
  const [error,   setError]   = useState(false)
  // Référence, BC, natures, signataire et désignations retouchées.
  const [bon,     setBon]     = useState(null)
  const [saving,  setSaving]  = useState(false)
  const [dl,      setDl]      = useState(false)

  useEffect(() => {
    src.load(id)
      .then(data => { setIv(data); setBon(initialBon(data)) })
      .catch(() => setError(true))
  }, [id, src])

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
      await src.save(id, bonPayload(bon, lines))
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

  if (error) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>{src.notFound}</div>
  if (!iv || !bon) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Chargement…</div>

  const lines = bonLines(iv, bon.natures, bon.custom)

  return (
    <div className="bi-wrap">
      {/* ── Barre d'écran : ce qui se règle avant d'imprimer ── */}
      <div className="bi-bar no-print">
        <BonFields value={bon} onChange={setBon} lines={lines} />

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

      <BonDocument iv={iv} company={company} reference={bon.ref} bc={bon.bc}
        signer={bon.signer} lines={lines} />
    </div>
  )
}

/** Réglages du bon tels qu'enregistrés, ou proposés pour une visite neuve. */
export function initialBon(iv) {
  const saved = savedNatures(iv.bon)
  return {
    ref:     iv.bon?.reference || '',
    bc:      iv.bon?.bonCommande || '',
    natures: saved.length ? saved : suggestNature(iv),
    signer:  iv.bon?.signataire || iv.visite?.visa || '',
    // Désignations retouchées, par ligne (« <nature>|<appareil> »).
    custom:  iv.bon?.designations || {},
  }
}

/**
 * Corps envoyé au serveur. Seules les lignes réellement modifiées sont
 * gardées : un texte identique au libellé par défaut suivra les évolutions
 * de ce dernier.
 */
export function bonPayload(bon, lines) {
  const autoOf = Object.fromEntries(lines.map(l => [l.key, l.auto]))
  const designations = Object.fromEntries(Object.entries(bon.custom || {})
    .filter(([k, v]) => autoOf[k] !== undefined && v.trim() && v.trim() !== autoOf[k]))
  return {
    reference: bon.ref, bonCommande: bon.bc, nature: bon.natures,
    signataire: bon.signer, designations,
  }
}

/**
 * Les champs réglables d'un bon : partagés par la page d'un bon et par
 * l'édition groupée de la semaine, pour qu'un bon se règle partout pareil.
 */
export function BonFields({ value, onChange, lines }) {
  const set = (k, v) => onChange(cur => ({ ...cur, [k]: v }))
  const setCustom = fn => onChange(cur => ({ ...cur, custom: fn(cur.custom || {}) }))
  const toggleNature = nid => onChange(cur => ({
    ...cur,
    natures: cur.natures.includes(nid) ? cur.natures.filter(n => n !== nid) : [...cur.natures, nid],
  }))

  return (
    <>
      <div className="bi-bar-group bi-bar-group--sm">
        <label className="bi-bar-label">Référence</label>
        <input className="form-input form-input--plain" value={value.ref}
          onChange={e => set('ref', e.target.value)} placeholder="352/2025" />
      </div>

      <div className="bi-bar-group bi-bar-group--sm">
        <label className="bi-bar-label">BC</label>
        <input className="form-input form-input--plain" value={value.bc}
          onChange={e => set('bc', e.target.value)} placeholder="N° bon de commande" />
      </div>

      <div className="bi-bar-group">
        <label className="bi-bar-label">Nom du signataire</label>
        <input className="form-input form-input--plain" value={value.signer}
          onChange={e => set('signer', e.target.value)}
          placeholder="Responsable du site" />
      </div>

      <div className="bi-bar-group bi-bar-group--full">
        <span className="bi-bar-label">Nature de l'intervention</span>
        <div className="bi-natures">
          {NATURES.map(n => {
            const on = value.natures.includes(n.id)
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
    </>
  )
}

/**
 * Le document lui-même, sans la barre de réglages : partagé par la page d'un
 * bon et par l'impression groupée de la semaine.
 */
export function BonDocument({ iv, company, reference, bc, signer, lines }) {
  const id         = String(iv._id)
  const dateVisite = iv.completedDate || iv.scheduledDate
  const site       = iv.siteName || iv.site?.name
  const website    = String(company.website || '').replace(/^https?:\/\//, '')
  const ref        = reference

  return (
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
                {/* Modèle et n° de série toujours imprimés, même si la
                    désignation a été retouchée. Un n° inconnu laisse une
                    ligne à compléter à la main sur place. */}
                <div className="bi-desi-sn">
                  Modèle : {l.model}
                  <span className="bi-desi-sep">·</span>
                  N° de série : {l.serial || <span className="bi-desi-blank" />}
                </div>
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
  )
}

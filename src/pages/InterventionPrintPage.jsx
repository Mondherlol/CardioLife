import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getIntervention, fichePhotoUrl } from '../api/interventions'
import { STATIC_BASE } from '../api/http'

const LOGO_URL = '/logo.png'

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}
function fmtShort(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTs(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_LABELS = { planifie: 'Planifié', en_cours: 'En cours', termine: 'Terminé' }

function Section({ title, children }) {
  return (
    <div className="pr-section">
      <div className="pr-section-title">{title}</div>
      {children}
    </div>
  )
}

/**
 * Pastille de constat du rapport — « Valide » / « Non valide » des auto-tests.
 *
 * Les autres colonnes disent désormais la mesure elle-même : le pourcentage
 * pour la batterie, la date de péremption pour les électrodes. Un verdict
 * calculé y aurait remplacé un fait par une interprétation.
 */
function EtatChip({ verdict }) {
  if (!verdict) return null
  return (
    <span className={`pr-dt-etat pr-dt-etat--${verdict.ok ? 'ok' : 'bad'}`}>
      {verdict.label}
    </span>
  )
}

/** Urgence d'une péremption : dépassée, proche (60 j), ou lointaine. */
function expLevel(date) {
  const days = Math.ceil((new Date(date) - new Date()) / 86400000)
  if (days < 0)  return 'past'
  if (days <= 60) return 'soon'
  return 'ok'
}

function InfoRow({ label, value }) {
  return (
    <tr>
      <td className="pr-label">{label}</td>
      <td className="pr-value">{value || '—'}</td>
    </tr>
  )
}

export default function InterventionPrintPage() {
  const { id }      = useParams()
  const [iv,    setIv]    = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    getIntervention(id).then(setIv).catch(() => setError(true))
  }, [id])

  useEffect(() => {
    if (iv) document.title = `Intervention — ${iv.clientName || id}`
  }, [iv, id])

  if (error) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Intervention introuvable.</div>
  if (!iv)   return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Chargement…</div>

  const snap = iv.installationSnap || {}

  /* Une visite couvre plusieurs appareils : le rapport les liste tous. Les
     interventions d'avant les visites multi-DAE n'ont qu'une fiche unique. */
  const fiches = (iv.fiches?.length ? iv.fiches : [iv.fiche || {}])
  const visite = iv.visite || iv.fiche || {}
  const photos = fiches.flatMap(f => (f.photos || []).map(fn => ({ fn, f })))

  const deviceImg = iv.installation?.deviceProduct?.images?.[0]
    ? `${STATIC_BASE}/uploads/products/${iv.installation.deviceProduct.images[0]}`
    : null

  /* Le DAE du parc que décrit cette fiche : c'est lui qui porte le n° de série
     et le type quand la checklist ne les a pas ressaisis. */
  const deaOf = f => (iv.siteDeas || []).find(d => String(d._id) === String(f.dea))

  /* Le libellé ne dit que le type et la marque : le numéro de série a sa
     propre colonne, l'y répéter la laissait vide et surchargeait celle-ci. */
  const deviceLabelOf = (f) => {
    const dea = deaOf(f)
    const label = dea?.deviceType
      || [snap.deviceType, iv.installation?.deviceProduct?.name || snap.deviceModel]
        .filter(Boolean).join(' · ')
      || f.deaLabel
      || 'DAE'
    /* Les fiches d'avant les colonnes séparées collaient le n° au libellé : on
       le retire par la fin, sans expression régulière — un numéro de série
       contient tout ce qu'il veut. */
    const sn = serialOf(f)
    let out = String(label)
    if (sn && out.endsWith(sn)) out = out.slice(0, -sn.length)
    return out.replace(/[\s·—-]+$/, '').trim() || 'DAE'
  }

  const serialOf = f => f.serialNumber || deaOf(f)?.serialNumber || snap.serialNumber || ''

  /* Sort de la formation, tranché pendant la visite. */
  const fo = iv.formation || {}
  const FORMATION_LABELS = { effectuee: 'Effectuée', reportee: 'Reportée' }
  const formationLine = fo.etat
    ? [
        FORMATION_LABELS[fo.etat] || fo.etat,
        fo.etat === 'effectuee' && fo.date ? `le ${fmtShort(fo.date)}` : '',
        fo.titre ? `— ${fo.titre}` : '',
        fo.note || '',
      ].filter(Boolean).join(' ')
    : null

  const observations = fiches.filter(f => f.observation)
  const hasObservations = observations.length > 0 || visite.observationGenerale

  return (
    <div className="pr-wrap">
      {/* ── Barre d'impression (écran seulement) ── */}
      <div className="pr-print-bar no-print">
        <button className="pr-print-btn" onClick={() => window.print()}>
          Imprimer / Télécharger en PDF
        </button>
        <button className="pr-print-btn pr-print-btn--ghost" onClick={() => window.close()}>
          Fermer
        </button>
      </div>

      {/* ── Document ── */}
      <div className="pr-document">

        {/* En-tête */}
        <div className="pr-header">
          <div className="pr-header-left">
            <div className="pr-logo-wrap">
              <img src={LOGO_URL} alt="CardioTrack" className="pr-logo"
                onError={e => { e.target.style.display = 'none' }} />
              <span className="pr-logo-text">CardioTrack</span>
            </div>
            <div className="pr-header-sub">Rapport d'intervention</div>
          </div>
          <div className="pr-header-right">
            <div className="pr-ref">Réf. #{id.slice(-8).toUpperCase()}</div>
            <div className="pr-status-badge">{STATUS_LABELS[iv.status] || iv.status}</div>
            <div className="pr-date-gen">Généré le {fmtTs(new Date())}</div>
          </div>
        </div>

        <div className="pr-divider" />

        {/* Client + Planification */}
        <div className="pr-two-col">
          <Section title="Client">
            <table className="pr-table">
              <tbody>
                <InfoRow label="Nom"         value={iv.clientName} />
                <InfoRow label="Adresse"     value={snap.address} />
              </tbody>
            </table>
          </Section>

          <Section title="Planification">
            <table className="pr-table">
              <tbody>
                <InfoRow label="Technicien"    value={iv.technicienName || iv.technicien?.fullName} />
                <InfoRow label="Date planifiée" value={fmt(iv.scheduledDate)} />
                <InfoRow label="Date de clôture" value={iv.completedDate ? fmt(iv.completedDate) : '—'} />
                {iv.notes && <InfoRow label="Notes" value={iv.notes} />}
              </tbody>
            </table>
          </Section>
        </div>

        {/* ── Tableau appareil ── */}
        <Section title={fiches.length > 1 ? `Appareils contrôlés (${fiches.length})` : "État de l'appareil"}>
          <table className="pr-device-table">
            <thead>
              <tr>
                <th>Type et marque<br />du DEA</th>
                <th>N° de Série</th>
                <th>Résultat des<br />auto-tests</th>
                <th>État pack<br />Signalétiques</th>
                <th>État de la batterie</th>
                <th>État des électrodes</th>
                <th>Armoire /<br />Boîtier</th>
              </tr>
            </thead>
            <tbody>
              {fiches.map((fiche, i) => {
                /* Les électrodes se lisent à leur date : c'est elle qui dit
                   s'il faut les changer, un « Valide » n'apprend rien. */
                const elecDates = [
                  { label: 'Adulte',      date: fiche.electrodesPeremptionAdulte },
                  { label: 'Pédiatrie',   date: fiche.electrodesPeremptionPediatrique },
                ].filter(d => d.date)
                return (
                <tr key={fiche.dea || i}>
                  {/* Type + image */}
                  <td>
                    <div className="pr-dt-device">
                      {deviceImg && i === 0 && (
                        <img src={deviceImg} alt="" className="pr-dt-img" />
                      )}
                      <span className="pr-dt-name">{deviceLabelOf(fiche)}</span>
                    </div>
                  </td>

                  {/* N° de série */}
                  <td className="pr-dt-center">
                    <span className="pr-dt-mono">{serialOf(fiche) || '—'}</span>
                  </td>

                  {/* Résultat des auto-tests — le verdict de l'appareil lui-même. */}
                  <td className="pr-dt-center">
                    {fiche.autotests == null
                      ? '—'
                      : <EtatChip verdict={{ ok: fiche.autotests, label: fiche.autotests ? 'Valide' : 'Non valide' }} />}
                  </td>

                  {/* Signalétique */}
                  <td className="pr-dt-center">{fiche.signaletique || '—'}</td>

                  {/* Batterie : le niveau de charge, et rien d'autre — c'est lui
                      qui dit l'état. Le pourcentage est celui relevé après la
                      pose quand la batterie a été remplacée. */}
                  <td className="pr-dt-center">
                    {/* Sans niveau relevé, le tiret est plus honnête qu'un
                        « Valide » : personne n'a lu la charge de l'appareil. */}
                    {fiche.batteriePct != null ? (
                      <span className={`pr-dt-pct pr-dt-pct--${
                        fiche.batteriePct >= 80 ? 'ok' : fiche.batteriePct >= 40 ? 'warn' : 'bad'
                      }`}>
                        {fiche.batteriePct}%
                      </span>
                    ) : '—'}
                    {fiche.batterieRemplacee && (
                      <span className="pr-dt-note">
                        Remplacée{fiche.batterieRemplaceeRef ? ` — ${fiche.batterieRemplaceeRef}` : ''}
                      </span>
                    )}
                    {fiche.batterieNote && (
                      <span className="pr-dt-note">{fiche.batterieNote}</span>
                    )}
                  </td>

                  {/* Électrodes : leur date de péremption. C'est l'échéance qui
                      dit quand il faudra revenir, pas un « Valide ». */}
                  <td className="pr-dt-center">
                    {elecDates.length === 0 ? (
                      <span className="pr-dt-note">Péremption non relevée</span>
                    ) : (
                      <span className="pr-dt-exps">
                        {elecDates.map(d => (
                          <span key={d.label} className={`pr-dt-exp pr-dt-exp--${expLevel(d.date)}`}>
                            <span className="pr-dt-exp-date">{fmtShort(d.date)}</span>
                            <span className="pr-dt-exp-kind">{d.label}</span>
                          </span>
                        ))}
                      </span>
                    )}
                    {fiche.electrodesRemplacees && (
                      <span className="pr-dt-note">
                        Remplacées{fiche.electrodesRemplaceesRef ? ` — ${fiche.electrodesRemplaceesRef}` : ''}
                      </span>
                    )}
                    {fiche.electrodesNote && (
                      <span className="pr-dt-note">{fiche.electrodesNote}</span>
                    )}
                  </td>

                  {/* Armoire : « Conforme » est le mot de la checklist, pas
                      celui d'un rapport remis au client. */}
                  <td className="pr-dt-center">
                    {(fiche.armoire || '').trim().toLowerCase() === 'conforme'
                      ? 'En bon état'
                      : (fiche.armoire || '—')}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </Section>

        {/* Visite */}
        <Section title="Informations de visite">
          <table className="pr-table">
            <tbody>
              <InfoRow label="Date de réception" value={visite.dateReception ? fmtShort(visite.dateReception) : '—'} />
              <InfoRow label="Visa / Signature"  value={visite.visa} />
              {/* La formation des agents fait partie de la prestation : le
                  client doit lire dans le rapport si sa séance a eu lieu. */}
              {formationLine && <InfoRow label="Formation des agents" value={formationLine} />}
            </tbody>
          </table>
        </Section>

        {/* Observations */}
        {hasObservations && (
          <Section title="Observations">
            {observations.map((f, i) => (
              <div key={f.dea || i} className="pr-note-box" style={{ marginBottom: 8 }}>
                <div className="pr-note-label">
                  {fiches.length > 1 ? deviceLabelOf(f) : 'Observation'}
                </div>
                <div className="pr-note-text">{f.observation}</div>
              </div>
            ))}
            {visite.observationGenerale && (
              <div className="pr-note-box">
                <div className="pr-note-label">Observation générale</div>
                <div className="pr-note-text">{visite.observationGenerale}</div>
              </div>
            )}
          </Section>
        )}

        {/* Photos */}
        {photos.length > 0 && (
          <Section title={`Photos (${photos.length})`}>
            <div className="pr-photos">
              {photos.map(({ fn, f }) => (
                <img key={fn} src={fichePhotoUrl(fn)} alt={deviceLabelOf(f)} className="pr-photo" />
              ))}
            </div>
          </Section>
        )}

        {/* Footer */}
        <div className="pr-divider" style={{ marginTop: 24 }} />
        <div className="pr-footer">
          <span>CardioTrack — Rapport généré le {fmtTs(new Date())}</span>
          <span>Réf. #{id.slice(-8).toUpperCase()}</span>
        </div>
      </div>
    </div>
  )
}

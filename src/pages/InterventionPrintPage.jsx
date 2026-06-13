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

  const snap   = iv.installationSnap || {}
  const fiche  = iv.fiche || {}
  const photos = fiche.photos || []

  const deviceLabel = [snap.deviceType, iv.installation?.deviceProduct?.name || snap.deviceModel]
    .filter(Boolean).join(' · ') || '—'

  const deviceImg = iv.installation?.deviceProduct?.images?.[0]
    ? `${STATIC_BASE}/uploads/products/${iv.installation.deviceProduct.images[0]}`
    : null

  const hasObservations = fiche.observation || fiche.observationGenerale

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
        <Section title="État de l'appareil">
          <table className="pr-device-table">
            <thead>
              <tr>
                <th>Type et marque<br />du DEA</th>
                <th>N° de Série</th>
                <th>Emplacement</th>
                <th>État pack<br />Signalétiques</th>
                <th>État de la batterie</th>
                <th>État des électrodes</th>
                <th>Armoire /<br />Boîtier</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                {/* Type + image */}
                <td>
                  <div className="pr-dt-device">
                    {deviceImg && (
                      <img src={deviceImg} alt="" className="pr-dt-img" />
                    )}
                    <span className="pr-dt-name">{deviceLabel}</span>
                  </div>
                </td>

                {/* N° de série */}
                <td className="pr-dt-center">
                  <span className="pr-dt-mono">
                    {fiche.serialNumber || snap.serialNumber || '—'}
                  </span>
                </td>

                {/* Emplacement */}
                <td>{fiche.emplacement || snap.location || '—'}</td>

                {/* Signalétique */}
                <td className="pr-dt-center">{fiche.signaletique || '—'}</td>

                {/* Batterie */}
                <td className="pr-dt-center">
                  {fiche.batteriePct != null && (
                    <span className={`pr-dt-pct pr-dt-pct--${
                      fiche.batteriePct >= 80 ? 'ok' : fiche.batteriePct >= 40 ? 'warn' : 'bad'
                    }`}>
                      {fiche.batteriePct}%
                    </span>
                  )}
                  {fiche.batterieNote && (
                    <span className="pr-dt-note">{fiche.batterieNote}</span>
                  )}
                  {fiche.batteriePct == null && !fiche.batterieNote && '—'}
                </td>

                {/* Électrodes */}
                <td className="pr-dt-center">
                  {fiche.electrodesPct != null && (
                    <span className={`pr-dt-pct pr-dt-pct--${
                      fiche.electrodesPct >= 80 ? 'ok' : fiche.electrodesPct >= 40 ? 'warn' : 'bad'
                    }`}>
                      {fiche.electrodesPct}%
                    </span>
                  )}
                  {fiche.electrodesNote && (
                    <span className="pr-dt-note">{fiche.electrodesNote}</span>
                  )}
                  {fiche.electrodesPct == null && !fiche.electrodesNote && '—'}
                </td>

                {/* Armoire */}
                <td className="pr-dt-center">{fiche.armoire || '—'}</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* Visite */}
        <Section title="Informations de visite">
          <table className="pr-table">
            <tbody>
              <InfoRow label="Date de réception" value={fiche.dateReception ? fmtShort(fiche.dateReception) : '—'} />
              <InfoRow label="Visa / Signature"  value={fiche.visa} />
            </tbody>
          </table>
        </Section>

        {/* Observations */}
        {hasObservations && (
          <Section title="Observations">
            {fiche.observation && (
              <div className="pr-note-box" style={{ marginBottom: 8 }}>
                <div className="pr-note-label">Observation</div>
                <div className="pr-note-text">{fiche.observation}</div>
              </div>
            )}
            {fiche.observationGenerale && (
              <div className="pr-note-box">
                <div className="pr-note-label">Observation générale</div>
                <div className="pr-note-text">{fiche.observationGenerale}</div>
              </div>
            )}
          </Section>
        )}

        {/* Photos */}
        {photos.length > 0 && (
          <Section title={`Photos (${photos.length})`}>
            <div className="pr-photos">
              {photos.map(fn => (
                <img key={fn} src={fichePhotoUrl(fn)} alt="photo" className="pr-photo" />
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

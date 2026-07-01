import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, Pencil, FileText, Users, Calendar, Tag, Zap, Package,
  GraduationCap, Boxes, Hash, MapPin, Clock, Archive,
} from 'lucide-react'
import { getContract, CONTRACT_TYPES, CONTRACT_STATUSES } from '../api/contracts'
import { useLoadingBar } from '../hooks/useLoadingBar'

const TYPE_MAP   = Object.fromEntries(CONTRACT_TYPES.map(t => [t.value, t.label]))
const STATUS_MAP = Object.fromEntries(CONTRACT_STATUSES.map(s => [s.value, s]))

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function formatPrice(v) {
  if (v == null || v === '' || Number.isNaN(Number(v))) return '—'
  return `${Number(v).toLocaleString('fr-FR')} DT`
}

export default function ContractDetailPage() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const [contract, setContract] = useState(null)
  const [loading,  setLoading]  = useState(true)

  useLoadingBar(loading)

  useEffect(() => {
    getContract(id)
      .then(setContract)
      .catch(err => { toast.error(err.message || 'Contrat introuvable.'); navigate('/contrats') })
      .finally(() => setLoading(false))
  }, [id, navigate])

  if (loading) return <div className="page-content"><div className="table-loading"><span className="spinner" /></div></div>
  if (!contract) return null

  const status = STATUS_MAP[contract.status]
  const periodLabel = contract.controlPeriodicity === 'semestriel' ? 'Semestriel'
    : contract.controlPeriodicity === 'annuel' ? 'Annuel' : '—'

  return (
    <div className="page-content">
      {/* En-tête */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="back-btn" onClick={() => navigate('/contrats')}><ArrowLeft size={16} /></button>
          <div>
            <h1 className="page-title" style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 10 }}>
              {contract.contractNumber || 'Contrat'}
              {status && <span className={`ct-status ${status.cls}`}>{status.label}</span>}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {TYPE_MAP[contract.type] || contract.type} · {contract.client?.name || contract.clientName}
            </p>
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => navigate(`/contrats/${id}/edit`)}>
          <Pencil size={14} /> Modifier
        </button>
      </div>

      {/* Infos clés */}
      <div className="ct-detail-grid">
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Users size={12} /> Client</span>
          <span className="ct-tile-value">{contract.client?.name || contract.clientName || '—'}</span>
        </div>
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Calendar size={12} /> Période</span>
          <span className="ct-tile-value">{formatDate(contract.startDate)} → {formatDate(contract.endDate)}</span>
        </div>
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Clock size={12} /> Contrôles</span>
          <span className="ct-tile-value">{periodLabel}</span>
        </div>
        <div className="ct-detail-tile">
          <span className="ct-tile-label"><Tag size={12} /> Valeur estimée</span>
          <span className="ct-tile-value ct-tile-value--accent">{formatPrice(contract.estimatedValue)}</span>
        </div>
      </div>

      {/* Packs */}
      {contract.packs?.length > 0 && (
        <div className="ct-section">
          <h3 className="ct-section-title"><Boxes size={15} /> Packs inclus</h3>
          <div className="ct-pack-chips">
            {contract.packs.map((p, i) => (
              <span key={i} className="ct-pack-chip"><Boxes size={12} /> {p.name || p.pack?.name || 'Pack'}</span>
            ))}
          </div>
        </div>
      )}

      {/* Installations */}
      <div className="ct-section">
        <h3 className="ct-section-title"><Zap size={15} /> Installations couvertes ({contract.installations?.length || 0})</h3>
        {contract.installations?.length ? (
          <div className="ct-install-list">
            {contract.installations.map(inst => (
              <div key={inst._id} className="ct-install-card ct-install-card--clickable"
                onClick={() => navigate(`/devices/${inst._id}`)} title="Voir l'installation">
                <span className="ct-install-icon"><Zap size={14} /></span>
                <div className="ct-install-body">
                  <div className="ct-install-title">{inst.deviceType || 'DAE'}{inst.serialNumber && <span className="ct-install-badge">N° {inst.serialNumber}</span>}</div>
                  <div className="ct-install-sub">
                    <MapPin size={11} /> {inst.address || '—'}
                    {inst.nextControlDate && <span> · Contrôle : {formatDate(inst.nextControlDate)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucune installation liée.</p>
        )}
      </div>

      {/* Produits & services */}
      {(contract.lineItems?.length > 0 || contract.services?.length > 0) && (
        <div className="ct-section">
          <h3 className="ct-section-title"><Package size={15} /> Détail des produits & services</h3>
          <table className="table">
            <thead>
              <tr><th>Désignation</th><th>Origine</th><th style={{ width: 70 }}>Qté</th><th style={{ width: 110 }}>Prix U.</th><th style={{ width: 120 }}>Total</th></tr>
            </thead>
            <tbody>
              {contract.lineItems?.map((li, i) => (
                <tr key={`li${i}`}>
                  <td><div className="cell-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Package size={12} color="var(--gray-300)" /> {li.productName}</div></td>
                  <td className="cell-muted">{li.fromPack ? <span className="ct-frompack-chip">pack : {li.fromPack}</span> : 'Produit seul'}</td>
                  <td>{li.quantity}</td>
                  <td className="cell-muted">{formatPrice(li.unitPrice)}</td>
                  <td className="cell-primary" style={{ fontWeight: 600 }}>{formatPrice((Number(li.unitPrice) || 0) * (Number(li.quantity) || 1))}</td>
                </tr>
              ))}
              {contract.services?.map((s, i) => (
                <tr key={`s${i}`}>
                  <td><div className="cell-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><GraduationCap size={12} color="var(--orange-500)" /> {s.name}</div></td>
                  <td className="cell-muted">{s.fromPack ? <span className="ct-frompack-chip">pack : {s.fromPack}</span> : 'Service'}</td>
                  <td>—</td>
                  <td className="cell-muted">{formatPrice(s.price)}</td>
                  <td className="cell-primary" style={{ fontWeight: 600 }}>{formatPrice(s.price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)' }}>Valeur estimée</td>
                <td style={{ fontWeight: 800, color: 'var(--orange-500)' }}>{formatPrice(contract.estimatedValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Notes */}
      {contract.notes && (
        <div className="ct-section">
          <h3 className="ct-section-title"><FileText size={15} /> Notes</h3>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #475569)', whiteSpace: 'pre-wrap', margin: 0 }}>{contract.notes}</p>
        </div>
      )}
    </div>
  )
}

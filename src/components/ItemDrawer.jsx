import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  X, ExternalLink, Hash, Layers, Truck, CalendarDays, Users, MapPin,
  AlertTriangle, Clock, ShoppingCart, Wrench, PackageCheck, Ban,
} from 'lucide-react'
import { setItemStatus, itemStatus } from '../api/productItems'
import { lookupClients } from '../api/clients'
import { useAuth } from '../context/AuthContext'
import ComboSearch from './ComboSearch'
import ClientModal from './ClientModal'
import SiteModal from './SiteModal'
import { getSites } from '../api/sites'

function formatApiError(err) {
  if (err.errors?.length) return err.errors.map(e => e.msg).join(' · ')
  return err.message || 'Une erreur est survenue.'
}

export function formatDate(dateStr) {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Feu tricolore de la DLC — mêmes seuils que le reste du stock. */
export function expiryLevel(dateStr) {
  if (!dateStr) return null
  const days = Math.ceil((new Date(dateStr) - new Date()) / 86400000)
  if (days < 0)   return { level: 'expired', days, label: 'Expiré' }
  if (days <= 30) return { level: 'urgent',  days, label: `${days} j` }
  if (days <= 90) return { level: 'soon',    days, label: `${days} j` }
  return { level: 'ok', days, label: formatDate(dateStr) }
}

export function ItemStatusChip({ status }) {
  const s = itemStatus(status)
  return <span className={`item-chip item-chip--${s.tone}`}>{s.label}</span>
}

/* Transitions offertes depuis l'état courant — on ne propose que ce qui a du
   sens : inutile de « vendre » un appareil déjà posé chez un client. */
function actionsFor(status) {
  const all = {
    reserve:     { label: 'Réserver',            icon: Clock,        status: 'reserve' },
    maintenance: { label: 'Envoyer en maintenance', icon: Wrench,    status: 'maintenance' },
    disponible:  { label: 'Remettre en stock',   icon: PackageCheck, status: 'disponible' },
    vendu:       { label: 'Marquer comme vendu', icon: ShoppingCart, status: 'vendu' },
    hs:          { label: 'Déclarer hors service', icon: Ban,        status: 'hs', danger: true },
  }
  switch (status) {
    case 'disponible':  return [all.reserve, all.maintenance, all.vendu, all.hs]
    case 'reserve':     return [all.disponible, all.vendu, all.maintenance]
    case 'maintenance': return [all.disponible, all.hs]
    case 'installe':    return [all.maintenance, all.disponible]
    case 'vendu':       return [all.disponible]
    case 'hs':          return [all.disponible]
    default:            return [all.disponible]
  }
}

/**
 * Confirmation d'un changement d'état.
 *
 * Réserver, c'est réserver *pour quelqu'un* : le client est obligatoire, et se
 * crée à la volée si le devis précède la fiche client. À la vente il reste
 * facultatif — c'est lui qui remplit la colonne Client du tableau.
 */
export function StatusConfirm({ item, target, onCancel, onDone }) {
  const { user } = useAuth()
  const [clients,  setClients]  = useState([])
  const [client,   setClient]   = useState(null)
  const [sites,    setSites]    = useState([])
  const [site,     setSite]     = useState(null)
  const [newSite,  setNewSite]  = useState(false)
  const [until,    setUntil]    = useState('')
  const [note,     setNote]     = useState('')
  const [creating, setCreating] = useState(false)
  const [saving,   setSaving]   = useState(false)

  const needsClient = target === 'reserve'
  const wantsClient = needsClient || target === 'vendu'
  /* La recherche est ouverte à tout utilisateur connecté, la création non :
     sans le droit, on n'affiche pas un bouton qui finirait en 403. */
  const canCreateClient = user?.role === 'superadmin' || !!user?.permissions?.canManageClients

  useEffect(() => {
    if (!wantsClient) return
    lookupClients({ limit: 500 })
      .then(d => setClients(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [wantsClient])

  // Réservation déjà en place, ou appareil déjà rattaché : on repart de là.
  useEffect(() => {
    const known = item.reservedFor?.client || item.client
    if (wantsClient && known?._id) setClient(known)
  }, [item, wantsClient])

  /* Les sites du client retenu : réserver, c'est réserver pour un lieu précis.
     La liste se recharge à chaque changement de client. */
  useEffect(() => {
    if (!needsClient || !client?._id) { setSites([]); setSite(null); return }
    getSites({ client: client._id })
      .then(list => {
        const arr = Array.isArray(list) ? list : []
        setSites(arr)
        // Un client mono-site ne laisse aucun choix à faire.
        setSite(arr.length === 1 ? arr[0] : null)
      })
      .catch(() => setSites([]))
  }, [needsClient, client])

  // Sans site, la pose ne saurait pas où aller.
  const canSubmit = !needsClient || (!!client && !!site)

  async function submit(e) {
    e.preventDefault()
    if (!canSubmit || saving) return
    setSaving(true)
    try {
      const updated = await setItemStatus(item._id, {
        status: target,
        note,
        client: wantsClient ? (client?._id || undefined) : undefined,
        site:   target === 'reserve' ? (site?._id || undefined) : undefined,
        until:  target === 'reserve' && until ? until : undefined,
      })
      toast.success(`Article ${itemStatus(target).label.toLowerCase()}.`)
      onDone(updated)
    } catch (err) {
      toast.error(formatApiError(err))
      setSaving(false)
    }
  }

  return (
    <>
      <form className="drawer-confirm" onSubmit={submit}>
        <div className="drawer-confirm-title">
          {itemStatus(item.status).label} → <strong>{itemStatus(target).label}</strong>
        </div>

        {wantsClient && (
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">
              Client {needsClient
                ? <span style={{ color: 'var(--red-500)' }}>*</span>
                : <span className="form-label-opt">(optionnel)</span>}
            </label>
            <ComboSearch
              items={clients}
              value={client}
              onChange={setClient}
              onClear={() => setClient(null)}
              displayFn={c => c.name}
              subtextFn={c => c.address?.city || ''}
              placeholder="Rechercher un client…"
              onCreateNew={canCreateClient ? () => setCreating(true) : undefined}
              emptyText="Aucun client à ce nom"
            />
          </div>
        )}

        {needsClient && client && (
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">
              Site <span style={{ color: 'var(--red-500)' }}>*</span>
            </label>
            <ComboSearch
              items={sites}
              value={site}
              onChange={setSite}
              onClear={() => setSite(null)}
              displayFn={s => s.name}
              subtextFn={s => [s.address?.street, s.address?.city].filter(Boolean).join(' · ')}
              placeholder="Rechercher un site…"
              onCreateNew={() => setNewSite(true)}
              emptyText={sites.length === 0
                ? "Ce client n'a aucun site"
                : 'Aucun site à ce nom'}
              emptyCtaLabel={() => 'Créer un site'}
            />
          </div>
        )}

        {target === 'reserve' && (
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">Réservé jusqu'au <span className="form-label-opt">(optionnel)</span></label>
            <input
              className="form-input form-input--plain"
              type="date"
              value={until}
              onChange={e => setUntil(e.target.value)}
            />
          </div>
        )}

        <input
          className="form-input form-input--plain"
          placeholder="Motif (optionnel) — Entrée pour valider"
          value={note}
          onChange={e => setNote(e.target.value)}
          autoFocus={!wantsClient}
        />

        <div className="drawer-confirm-actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={saving}>Annuler</button>
          <button type="submit" className="btn btn--primary" disabled={saving || !canSubmit}>
            {saving ? <span className="login-btn-spinner" /> : 'Confirmer'}
          </button>
        </div>
      </form>

      {newSite && client && (
        <SiteModal
          clientId={client._id}
          site={null}
          onClose={() => setNewSite(false)}
          onSaved={created => {
            setNewSite(false)
            if (!created?._id) return
            setSites(list => [created, ...list])
            setSite(created)
          }}
        />
      )}

      {creating && (
        <ClientModal
          client={null}
          onClose={() => setCreating(false)}
          onSaved={created => {
            setCreating(false)
            if (!created?._id) return
            setClients(list => [created, ...list])
            setClient(created)
          }}
        />
      )}
    </>
  )
}

/**
 * Panneau latéral : le coup d'œil rapide sur un exemplaire depuis le tableau.
 * Tout ce qui demande de la place — le journal de vie, les liens vers le parc —
 * vit sur la fiche complète.
 */
export default function ItemDrawer({ item, category, onClose, onChanged }) {
  const navigate = useNavigate()
  const [pending, setPending] = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => { setPending(null) }, [item?._id])

  if (!item) return null

  const exp   = expiryLevel(item.expirationDate)
  const isLot = !item.serialNumber && !!item.lotNumber

  const rows = [
    { label: 'Référence',   icon: Hash,         value: item.reference },
    { label: 'N° de série', icon: Hash,         value: item.serialNumber, mono: true },
    { label: 'N° de lot',   icon: Layers,       value: item.lotNumber, mono: true },
    { label: 'Quantité',    icon: Layers,       value: isLot ? `${item.quantity} unité${item.quantity > 1 ? 's' : ''}` : null },
    { label: 'Fournisseur', icon: Truck,        value: item.supplier },
    { label: 'Date d\'entrée', icon: CalendarDays, value: formatDate(item.entryDate) },
    { label: 'Date de vente',  icon: ShoppingCart, value: formatDate(item.saleDate) },
    { label: 'Client',      icon: Users,        value: item.client?.name || item.reservedFor?.client?.name },
    { label: 'Site',        icon: MapPin,       value: item.site?.name },
  ].filter(r => r.value)

  return (
    <div className="drawer-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-label="Détail de l'article">
        <div className="drawer-header">
          <div>
            <div className="drawer-eyebrow">{item.product?.name || 'Article'}</div>
            <h2 className="drawer-title">
              {item.serialNumber || item.lotNumber || item.reference || 'Sans identifiant'}
            </h2>
            <div className="drawer-badges">
              <ItemStatusChip status={item.status} />
              {exp && category?.tracksLot && (
                <span className={`item-exp item-exp--${exp.level}`}>
                  {exp.level === 'expired' ? <AlertTriangle size={11} /> : <Clock size={11} />}
                  DLC {exp.level === 'ok' ? exp.label : `· ${exp.label}`}
                </span>
              )}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="drawer-body">
          <dl className="drawer-grid">
            {rows.map(r => {
              const Icon = r.icon
              return (
                <div key={r.label} className="drawer-row">
                  <dt><Icon size={12} /> {r.label}</dt>
                  <dd className={r.mono ? 'drawer-mono' : undefined}>{r.value}</dd>
                </div>
              )
            })}
          </dl>

          {item.reservedFor?.note && (
            <p className="drawer-note"><Clock size={12} /> {item.reservedFor.note}</p>
          )}
          {item.notes && <p className="drawer-note">{item.notes}</p>}

          {/* Changement d'état : confirmation en deux temps, avec un motif qui
              atterrit dans le journal de vie de l'article. */}
          {pending ? (
            <StatusConfirm
              item={item}
              target={pending.status}
              onCancel={() => setPending(null)}
              onDone={updated => { setPending(null); onChanged(updated) }}
            />
          ) : (
            <div className="drawer-actions">
              {actionsFor(item.status).map(a => {
                const Icon = a.icon
                return (
                  <button
                    key={a.status}
                    className={`drawer-action${a.danger ? ' drawer-action--danger' : ''}`}
                    onClick={() => setPending(a)}
                  >
                    <Icon size={14} /> {a.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <button className="btn btn--primary" onClick={() => navigate(`/stock/articles/${item._id}`)}>
            <ExternalLink size={14} /> Ouvrir la fiche complète
          </button>
        </div>
      </aside>
    </div>
  )
}

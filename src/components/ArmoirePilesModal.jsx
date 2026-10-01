import { useEffect, useMemo } from 'react'
import { X, Archive, Building2, ChevronRight, MapPin } from 'lucide-react'
import { formatDate } from './siteHelpers'

/**
 * Armoires dont les piles de l'alarme sont à remplacer, rangées par client.
 *
 * Ouverte depuis l'alerte du tableau de bord : on y cherche qui appeler, donc
 * la liste se lit client par client, avec ses sites et ses appareils. Le clic
 * sur un client ouvre sa fiche, où l'armoire se met à jour.
 *
 * `installations` : le parc au format « installation » (voir `deaParc`).
 */
export default function ArmoirePilesModal({ installations, onClose, onOpenClient }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const clients = useMemo(() => {
    const byClient = new Map()
    for (const inst of installations) {
      if (inst.armoire?.pilesStatus !== 'a_remplacer') continue
      const id = String(inst.client?._id || inst.client || inst.clientName)
      if (!byClient.has(id)) {
        byClient.set(id, { id: inst.client?._id || null, name: inst.clientName || 'Client', sites: new Map(), count: 0 })
      }
      const c = byClient.get(id)
      const siteName = inst.site?.name || '—'
      if (!c.sites.has(siteName)) c.sites.set(siteName, { name: siteName, city: inst.site?.address?.city, deas: [] })
      c.sites.get(siteName).deas.push(inst)
      c.count++
    }
    return [...byClient.values()]
      .map(c => ({ ...c, sites: [...c.sites.values()] }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'))
  }, [installations])

  const total = clients.reduce((n, c) => n + c.count, 0)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal arm-alert-modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2 className="modal-title">
            <Archive size={16} /> {total} armoire{total > 1 ? 's' : ''} — piles à remplacer
          </h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="arm-alert-intro">
            {clients.length} client{clients.length > 1 ? 's' : ''} concerné{clients.length > 1 ? 's' : ''}.
            L'état vient du dernier contrôle ; une fois les piles changées, mettez l'armoire à jour depuis la
            checklist de la visite ou depuis la fiche du client.
          </p>
          <div className="arm-alert-list">
            {clients.map(c => (
              <div key={c.id || c.name} className="arm-alert-client">
                <button type="button" className="arm-alert-head" disabled={!c.id}
                  onClick={() => c.id && onOpenClient(c.id)} title="Ouvrir la fiche du client">
                  <Building2 size={14} />
                  <span className="arm-alert-name">{c.name}</span>
                  <span className="arm-alert-count">{c.count} armoire{c.count > 1 ? 's' : ''}</span>
                  {c.id && <ChevronRight size={14} />}
                </button>
                {c.sites.map(s => (
                  <div key={s.name} className="arm-alert-site">
                    <span className="arm-alert-site-name">
                      <MapPin size={11} /> {s.name}{s.city ? ` · ${s.city}` : ''}
                    </span>
                    <ul>
                      {s.deas.map(d => (
                        <li key={d._id}>
                          <span>{[d.deviceType, d.serialNumber].filter(Boolean).join(' · ') || 'DAE'}</span>
                          {d.location && <span className="arm-alert-muted">{d.location}</span>}
                          <span className="arm-alert-muted">
                            {d.armoire.model ? `Armoire ${d.armoire.model}` : 'Armoire'}
                            {d.armoire.pilesCheckedAt ? ` · constaté le ${formatDate(d.armoire.pilesCheckedAt)}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

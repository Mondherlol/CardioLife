import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Pencil, Trash2, X, AlertTriangle, ChevronRight,
  Zap, BatteryMedium, Building2, UserPlus, Settings2,
  Table2, LayoutGrid, ArrowUpRight, HeartPulse, FileText,
  CalendarClock,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { getSites, deleteSite } from '../api/sites'
import { getContracts } from '../api/contracts'
import ContractModal from './ContractModal'
import SiteModal from './SiteModal'
import DeaModal from './DeaModal'
import DeaItemsModal from './DeaItemsModal'
import NextControlModal from './NextControlModal'
import ContextMenu from './ContextMenu'
import DeleteDeaConfirm from './DeleteDeaConfirm'
import SitesTableView from './SitesTableView'
import InstallationPlanModal from './InstallationPlanModal'
import { getProductItems } from '../api/productItems'
import SitesCardsView from './SitesCardsView'
import { formatApiError } from './siteHelpers'

const VIEW_KEY = 'cardiotrack.sites.view'

function DeleteSiteConfirm({ site, onClose, onDone }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function confirm() {
    setLoading(true)
    try {
      await deleteSite(site._id)
      toast.success('Site supprimé.')
      onDone()
    } catch (err) { setError(formatApiError(err)); setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">Supprimer le site</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-text">
            Supprimer <strong>{site.name}</strong> ?
            {site.deas?.length > 0 && ` Ses ${site.deas.length} DEA seront également supprimés.`}
            {' '}Cette action est irréversible.
          </p>
          {error && <div className="login-error"><AlertTriangle size={13} /> {error}</div>}
          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn--danger" onClick={confirm} disabled={loading}>
              {loading ? <span className="login-btn-spinner" /> : 'Supprimer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Choix du site cible pour une action lancée depuis un en-tête de colonne.
 * purpose : 'dea' (nouveau DEA) | 'contact' (nouveau responsable)
 */
function PickSiteModal({ sites, purpose, onPick, onCreateSite, onClose }) {
  const isDea = purpose === 'dea'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--sm">
        <div className="modal-header">
          <h2 className="modal-title">{isDea ? 'Ajouter un DEA' : 'Ajouter un responsable'}</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="pick-site-hint">
            {isDea ? 'Sur quel site ce DEA est-il installé ?' : 'De quel site ce responsable s\'occupe-t-il ?'}
          </p>

          {sites.length > 0 && (
            <div className="pick-site-list">
              {sites.map(s => (
                <button key={s._id} type="button" className="pick-site-item" onClick={() => onPick(s)}>
                  <Building2 size={15} />
                  <span className="pick-site-item-main">
                    <span className="pick-site-item-name">{s.name}</span>
                    {(s.address?.street || s.address?.city) && (
                      <span className="pick-site-item-addr">
                        {[s.address?.street, s.address?.city].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="pick-site-item-count">
                    {isDea ? `${s.deas?.length || 0} DEA` : `${s.contacts?.length || 0} resp.`}
                  </span>
                  <ChevronRight size={15} className="pick-site-item-chev" />
                </button>
              ))}
            </div>
          )}

          {isDea && (
            <button type="button" className="pick-site-new" onClick={onCreateSite}>
              <Plus size={14} /> Créer un nouveau site
            </button>
          )}

          <div className="modal-footer">
            <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Sites d'un client, en tableau dense ou en fiches, au choix.
 *
 * Édition dans les deux vues : clic sur une valeur pour la modifier en place,
 * clic droit pour le menu complet de la ligne / du site.
 *
 * Props :
 *  clientId      - id du client
 *  onCountChange - ({ sites, deas }) => void, pour les compteurs du bandeau
 */
export default function SitesClientTab({ clientId, onCountChange }) {
  const navigate = useNavigate()
  const [sites,   setSites]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [view,    setView]    = useState(() => localStorage.getItem(VIEW_KEY) || 'cards')

  const [siteModal,  setSiteModal]  = useState(null)   // null | { site, focus, chainDea }
  const [deaModal,   setDeaModal]   = useState(null)   // null | { site, dea }
  const [itemsModal, setItemsModal] = useState(null)   // null | { site, dea, kind }
  const [ctrlModal,  setCtrlModal]  = useState(null)   // null | { site, dea }
  const [pickSite,   setPickSite]   = useState(null)   // null | 'dea' | 'contact'
  const [deleting,   setDeleting]   = useState(null)   // site à supprimer
  const [deaDeleting, setDeaDeleting] = useState(null) // { site, dea }
  const [menu,       setMenu]       = useState(null)   // null | { x, y, title, items }
  // Contrat en cours par site : un contrat couvre un site, pas le client.
  const [contracts,  setContracts]  = useState({})     // siteId → contrat
  const [ctrModal,   setCtrModal]   = useState(null)   // null | { site }
  // Matériel réservé pour ce client : il attend une pose.
  const [reserved,   setReserved]   = useState([])
  const [planOpen,   setPlanOpen]   = useState(null)   // null | { site }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [data, ctrRes] = await Promise.all([
        getSites({ client: clientId }),
        getContracts({ client: clientId, status: 'actif', limit: 200 }).catch(() => ({ data: [] })),
      ])
      setSites(Array.isArray(data) ? data : [])
      setContracts(Object.fromEntries(
        (ctrRes?.data || []).filter(c => c.site).map(c => [String(c.site._id || c.site), c])
      ))
    } catch (err) {
      const msg = formatApiError(err)
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const loadReserved = useCallback(() => {
    getProductItems({ client: clientId, status: 'reserve' })
      .then(res => setReserved(Array.isArray(res.data) ? res.data : []))
      .catch(() => setReserved([]))
  }, [clientId])

  useEffect(() => { loadReserved() }, [loadReserved])

  useEffect(() => {
    onCountChange?.({
      sites: sites.length,
      deas:  sites.reduce((n, s) => n + (s.deas?.length || 0), 0),
    })
  }, [sites, onCountChange])

  function changeView(next) {
    setView(next)
    localStorage.setItem(VIEW_KEY, next)
  }

  /* Remplace un site dans la liste après édition d'un site ou d'un DEA. */
  const replaceSite = useCallback(updated => {
    setSites(list => {
      const exists = list.some(s => s._id === updated._id)
      const next = exists
        ? list.map(s => (s._id === updated._id ? updated : s))
        : [...list, updated]
      return next.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    })
  }, [])

  /* Le site créé depuis le sélecteur enchaîne directement sur l'ajout du DEA. */
  function handleSiteSaved(saved, chainDea) {
    replaceSite(saved)
    setSiteModal(null)
    if (chainDea) setDeaModal({ site: saved, dea: null })
  }

  /* ── Actions partagées par les deux vues ───────────── */
  const act = {
    // Fiche du site : historique complet (formations, contrôles, consommables…).
    openSite:     site => navigate(`/sites/${site._id}`),
    addSite:      () => setSiteModal({ site: null }),
    editSite:     site => setSiteModal({ site }),
    editContacts: site => setSiteModal({ site, focus: 'contacts' }),
    deleteSite:   site => setDeleting(site),
    addDea:       site => setDeaModal({ site, dea: null }),
    editDea:      (site, dea) => setDeaModal({ site, dea }),
    editControl:  (site, dea) => setCtrlModal({ site, dea }),
    deleteDea:    (site, dea) => setDeaDeleting({ site, dea }),
    items:        (site, dea, kind) => setItemsModal({ site, dea, kind }),
    pickSite:     purpose => setPickSite(purpose),
    planInstall:  site => setPlanOpen({ site: site || null }),

    /* Matériel déjà promis à ce client et pas encore posé. Un article réservé
       pour un site précis n'apparaît que sur celui-ci ; sans site désigné, il
       concerne encore n'importe lequel. */
    reservedFor: site => reserved.filter(it => {
      const s = it.reservedFor?.site?._id || it.reservedFor?.site || it.site?._id || it.site
      return !s || String(s) === String(site._id)
    }),

    /* Contrat du site : ouverture s'il existe, création sinon — impossible tant
       qu'aucun DAE n'est posé, il n'y aurait rien à contrôler. */
    contractOf: site => contracts[String(site._id)] || null,
    openContract: site => {
      const c = act.contractOf(site)
      if (c) navigate(`/contrats/${c._id}`)
      else if (!site.deas?.length) {
        toast.info(`Posez d'abord un DAE sur « ${site.name} » : un contrat sans appareil n'a rien à contrôler.`)
      } else {
        setCtrModal({ site })
      }
    },

    /* Actions du site, communes aux deux menus contextuels. */
    siteItems: site => {
      const contract = act.contractOf(site)
      return [
        { label: 'Ouvrir la fiche du site',   icon: ArrowUpRight, onClick: () => act.openSite(site) },
        contract
          ? { label: `Voir le contrat ${contract.contractNumber || ''}`.trim(), icon: FileText, onClick: () => act.openContract(site) }
          : { label: 'Créer un contrat', icon: FileText, disabled: !site.deas?.length, onClick: () => act.openContract(site) },
        { separator: true },
        { label: 'Ajouter un DEA',            icon: Plus,      onClick: () => act.addDea(site) },
        { label: 'Modifier les responsables', icon: UserPlus,  onClick: () => act.editContacts(site) },
        { label: 'Modifier le site',          icon: Settings2, onClick: () => act.editSite(site) },
        { separator: true },
        { label: 'Supprimer le site', icon: Trash2, danger: true, onClick: () => act.deleteSite(site) },
      ]
    },

    deaMenu(e, site, dea) {
      e.preventDefault()
      e.stopPropagation()
      setMenu({
        x: e.clientX, y: e.clientY,
        title: `${dea.deviceType || 'DEA'}${dea.location ? ` · ${dea.location}` : ''}`,
        items: [
          { label: 'Modifier ce DEA',      icon: Pencil,        onClick: () => act.editDea(site, dea) },
          { label: 'Modifier le prochain contrôle', icon: CalendarClock, onClick: () => act.editControl(site, dea) },
          { label: 'Gérer les batteries',  icon: BatteryMedium, onClick: () => act.items(site, dea, 'batteries') },
          { label: 'Gérer les électrodes', icon: Zap,           onClick: () => act.items(site, dea, 'electrodes') },
          { label: 'Retirer ce DEA', icon: Trash2, danger: true, onClick: () => act.deleteDea(site, dea) },
          { separator: true },
          ...act.siteItems(site),
        ],
      })
    },

    siteMenu(e, site) {
      e.preventDefault()
      e.stopPropagation()
      setMenu({ x: e.clientX, y: e.clientY, title: site.name, items: act.siteItems(site) })
    },
  }

  if (loading) return <div className="table-loading"><span className="spinner" /></div>

  const deaTotal  = sites.reduce((n, s) => n + (s.deas?.length || 0), 0)
  const viewProps = { sites, act, contracts }


  return (
    <div className="cd-table-tab">
      <div className="cd-tab-header">
        <div className="cd-tab-headline">
          <h3 className="cd-tab-title">Sites ({sites.length}) · {deaTotal} DEA</h3>
          <p className="cd-tab-hint">
            Clic sur un site pour sa fiche · sur un DEA pour le modifier · sur une pastille
            pour ses consommables ou pour corriger l'échéance · clic droit pour toutes les actions
          </p>
        </div>

        <div className="view-switch" role="group" aria-label="Mode d'affichage">
          <button type="button" title="Affichage en fiches"
            className={`view-switch-btn${view === 'cards' ? ' view-switch-btn--on' : ''}`}
            onClick={() => changeView('cards')}>
            <LayoutGrid size={14} /> Fiches
          </button>
          <button type="button" title="Affichage en tableau"
            className={`view-switch-btn${view === 'table' ? ' view-switch-btn--on' : ''}`}
            onClick={() => changeView('table')}>
            <Table2 size={14} /> Tableau
          </button>
        </div>
      </div>

      {error && <div className="table-error"><AlertTriangle size={15} /> {error}</div>}

      {sites.length === 0 ? (
        <div className="cd-tab-empty">
          <Building2 size={40} color="var(--gray-300)" />
          <p>Aucun site enregistré pour ce client.</p>
          <button className="btn btn--primary" onClick={act.addSite}>
            <Plus size={14} /> Créer le premier site
          </button>
        </div>
      ) : (
        <>
          {view === 'table'
            ? <SitesTableView {...viewProps} />
            : <SitesCardsView {...viewProps} />}

          {/* Les ajouts vivent sous la liste : les lignes restent purement cliquables. */}
          <div className="sites-add-row">
            <button type="button" className="btn btn--ghost" onClick={act.addSite}>
              <Plus size={14} /> Ajouter un site
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => act.pickSite('dea')}>
              <HeartPulse size={14} /> Ajouter un DEA
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setPlanOpen({ site: null })}>
              <CalendarClock size={14} /> Planifier une installation
            </button>
          </div>
        </>
      )}

      {menu && (
        <ContextMenu
          x={menu.x} y={menu.y} title={menu.title} items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}

      {ctrModal && (
        <ContractModal
          site={ctrModal.site}
          onClose={() => setCtrModal(null)}
          onSaved={saved => { setCtrModal(null); navigate(`/contrats/${saved._id}`) }}
        />
      )}

      {siteModal && (
        <SiteModal
          clientId={clientId}
          site={siteModal.site}
          focus={siteModal.focus}
          onClose={() => setSiteModal(null)}
          onSaved={saved => handleSiteSaved(saved, siteModal.chainDea)}
        />
      )}

      {pickSite && (
        <PickSiteModal
          sites={sites}
          purpose={pickSite}
          onPick={site => {
            const purpose = pickSite
            setPickSite(null)
            if (purpose === 'dea') act.addDea(site)
            else act.editContacts(site)
          }}
          onCreateSite={() => { setPickSite(null); setSiteModal({ site: null, chainDea: true }) }}
          onClose={() => setPickSite(null)}
        />
      )}

      {planOpen && (
        <InstallationPlanModal
          clientId={clientId}
          sites={sites}
          site={planOpen.site}
          onClose={() => setPlanOpen(null)}
          onDone={() => { setPlanOpen(null); load(); loadReserved() }}
        />
      )}

      {deaModal && (
        <DeaModal
          site={deaModal.site}
          dea={deaModal.dea}
          contract={contracts[String(deaModal.site._id)]}
          onClose={() => setDeaModal(null)}
          // Un DEA peut créer le contrat du site : on recharge les deux.
          onSaved={updated => { replaceSite(updated); setDeaModal(null); load() }}
        />
      )}

      {ctrlModal && (
        <NextControlModal
          site={ctrlModal.site}
          dea={ctrlModal.dea}
          onClose={() => setCtrlModal(null)}
          // La visite planifiée a bougé avec la date : le contrat se relit.
          onSaved={updated => { replaceSite(updated); setCtrlModal(null); load() }}
        />
      )}

      {itemsModal && itemsModal.dea && (
        <DeaItemsModal
          site={itemsModal.site}
          dea={itemsModal.dea}
          kind={itemsModal.kind}
          onClose={() => setItemsModal(null)}
          onSaved={updated => { replaceSite(updated); setItemsModal(null) }}
        />
      )}

      {deleting && (
        <DeleteSiteConfirm
          site={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => { setSites(list => list.filter(s => s._id !== deleting._id)); setDeleting(null) }}
        />
      )}

      {deaDeleting && (
        <DeleteDeaConfirm
          site={deaDeleting.site}
          dea={deaDeleting.dea}
          onClose={() => setDeaDeleting(null)}
          onDone={updated => { replaceSite(updated); setDeaDeleting(null) }}
        />
      )}
    </div>
  )
}

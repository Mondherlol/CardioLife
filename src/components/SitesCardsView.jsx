import {
  Phone, Mail, Building2, MapPin, HeartPulse, Hash, CalendarDays, ArrowUpRight, Plus,
} from 'lucide-react'
import { formatDate, ItemsButton, ContractChip, NoDeaBox } from './siteHelpers'

/* Une ligne d'information d'un DEA : icône, libellé, valeur. */
function DeaField({ icon: Icon, label, children }) {
  return (
    <div className="deac-field">
      <span className="deac-field-label"><Icon size={12} /> {label}</span>
      <div className="deac-field-value">{children}</div>
    </div>
  )
}

function DeaCard({ site, dea, index, total, act }) {
  /* La carte ouvre son DEA ; les pastilles de consommables ont leur propre
     modale et ne doivent pas déclencher celle-ci. */
  const openDea = e => {
    if (e.target.closest('button')) return
    e.stopPropagation()
    act.editDea(site, dea)
  }

  return (
    <article className="deac deac--clickable" title="Modifier ce DEA"
      onClick={openDea}
      onContextMenu={e => act.deaMenu(e, site, dea)}>
      <header className="deac-head">
        <span className="deac-badge"><HeartPulse size={13} /></span>
        <div className="deac-title">{dea.deviceType || <span className="site-cell-empty">Type non renseigné</span>}</div>
        {dea.status === 'a_installer' && (
          <span className="dea-pending-tag" title="Pose planifiée, pas encore posée">À installer</span>
        )}
        {total > 1 && <span className="deac-index">{index + 1}/{total}</span>}
      </header>

      <div className="deac-fields">
        <DeaField icon={MapPin} label="Lieu">
          {dea.location || <span className="site-cell-empty">—</span>}
        </DeaField>
        <DeaField icon={Hash} label="N° de série">
          {dea.serialNumber
            ? <span className="dea-sn">{dea.serialNumber}</span>
            : <span className="site-cell-empty">—</span>}
        </DeaField>
        <DeaField icon={CalendarDays} label="Installation">
          {dea.installationDate
            ? <span className="dea-date">{formatDate(dea.installationDate)}</span>
            : <span className="site-cell-empty">—</span>}
        </DeaField>
      </div>

      <footer className="deac-conso">
        <ItemsButton full kind="batteries"  items={dea.batteries}
          onClick={() => act.items(site, dea, 'batteries')} />
        <ItemsButton full kind="electrodes" items={dea.electrodes}
          onClick={() => act.items(site, dea, 'electrodes')} />
      </footer>
    </article>
  )
}

/**
 * Vue fiches : une section par site, ses responsables puis ses DEA en cartes.
 *
 * Comme la vue tableau, le clic suit ce qu'il vise : l'en-tête du site ouvre sa
 * fiche, une carte de DEA ouvre ce DEA, une pastille ouvre ses consommables.
 * Le clic droit garde le menu d'actions.
 */
export default function SitesCardsView({ sites, act, contracts = {} }) {
  /* La carte entière ouvre la fiche, sauf les boutons qu'elle contient : ceux-là
     ont leur propre action. */
  const openUnlessButton = site => e => {
    if (e.target.closest('button')) return
    act.openSite(site)
  }

  return (
    <div className="sitec-list">
      {sites.map(site => {
        const deas = site.deas || []
        return (
          <section key={site._id} className="sitec sitec--clickable"
            onClick={openUnlessButton(site)}
            onContextMenu={e => act.siteMenu(e, site)}>
            <header className="sitec-head">
              <span className="sitec-icon"><Building2 size={17} /></span>

              <div className="sitec-ident">
                <div className="sitec-name">
                  {site.name}
                  <ArrowUpRight size={13} className="sitec-name-go" />
                </div>
                <div className="sitec-addr">
                  <MapPin size={11} />
                  {[site.address?.street, site.address?.city].filter(Boolean).join(' · ')
                    || <span className="site-cell-empty">Adresse non renseignée</span>}
                </div>
              </div>

              {/* Le contrat couvre le site : chacun a son propre calendrier. */}
              <ContractChip contract={contracts[String(site._id)]} />

              <span className="sitec-count">
                <HeartPulse size={12} /> {deas.length} DEA
              </span>
            </header>

            <div className="sitec-resp">
              <span className="sitec-section-label">Responsables</span>
              <div className="sitec-resp-list">
                {site.contacts?.length ? site.contacts.map((c, i) => (
                  <div key={i} className="respc">
                    <span className="respc-avatar">
                      {(c.name || '?').trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="respc-main">
                      <span className="respc-name">{c.name || 'Sans nom'}</span>
                      {c.phone && <span className="respc-line"><Phone size={10} /> {c.phone}</span>}
                      {c.email && <span className="respc-line"><Mail size={10} /> {c.email}</span>}
                    </span>
                  </div>
                )) : (
                  <span className="site-cell-empty">Aucun responsable enregistré</span>
                )}
              </div>
            </div>

            <div className="sitec-deas">
              {deas.length === 0 ? (
                <NoDeaBox site={site} act={act} wide />
              ) : (
                <div className="sitec-dea-grid">
                  {deas.map((dea, i) => (
                    <DeaCard key={dea._id} site={site} dea={dea} index={i} total={deas.length} act={act} />
                  ))}
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

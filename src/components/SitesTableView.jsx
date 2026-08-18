import { Phone, Mail, HeartPulse, ArrowUpRight, Plus } from 'lucide-react'
import { formatDate, ItemsButton, ContractChip, NoDeaBox, NextControlChip } from './siteHelpers'

/**
 * Vue tableau : une ligne par DEA, les colonnes site et responsable fusionnées
 * sur les DEA du site.
 *
 * Le clic suit la colonne pointée : les cellules du site ouvrent sa fiche,
 * celles d'un DEA ouvrent ce DEA, une pastille de consommables ouvre ses
 * électrodes ou ses batteries. Le clic droit garde le menu complet.
 * Props : voir `viewProps` construit par SitesClientTab.
 */
export default function SitesTableView({ sites, act, contracts = {} }) {
  /* Les boutons contenus dans une cellule ont leur propre action : le clic ne
     doit pas déclencher aussi celle de la cellule. */
  const cellClick = fn => e => {
    if (e.target.closest('button')) return
    fn()
  }

  return (
    <div className="table-wrap sites-xl-wrap">
      <table className="sites-xl sites-xl--clickable">
        {/* La colonne Contrat ne porte plus qu'un « Oui / Non » : elle n'a pas
            besoin de plus que le chip, la place va aux colonnes qui la méritent. */}
        <colgroup>
          <col style={{ width: 215 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 205 }} />
          <col style={{ width: 190 }} />
          <col style={{ width: 165 }} />
          <col style={{ width: 145 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 165 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="sites-xl-site"><div className="th-inner">Site</div></th>
            <th className="sites-xl-ct"><div className="th-inner">Contrat</div></th>
            <th className="sites-xl-resp"><div className="th-inner">Responsable</div></th>
            <th><div className="th-inner">Lieu d'installation</div></th>
            <th><div className="th-inner">Type</div></th>
            <th><div className="th-inner">N° de série</div></th>
            <th><div className="th-inner">Installation</div></th>
            <th><div className="th-inner">Prochain contrôle</div></th>
            <th><div className="th-inner">Consommables</div></th>
          </tr>
        </thead>

        {/* Un <tbody> par site : le regroupement visuel ne dépend pas du survol. */}
        {sites.map(site => {
          const deas = site.deas || []
          const span = Math.max(deas.length, 1)

          const siteCells = (
            <>
              <td className="sites-xl-site" rowSpan={span}
                onClick={cellClick(() => act.openSite(site))}
                title="Ouvrir la fiche du site">
                <div className="site-cell-name">
                  {site.name}
                  <ArrowUpRight size={12} className="site-cell-go" />
                </div>
                <div className="site-cell-addr">
                  {[site.address?.street, site.address?.city].filter(Boolean).join(' · ')
                    || <span className="site-cell-empty">Adresse non renseignée</span>}
                </div>
              </td>

              {/* Le contrat couvre le site : chacun a son propre calendrier. Le
                  détail vit sur la fiche, c'est donc elle que le clic ouvre. */}
              <td className="sites-xl-ct" rowSpan={span}
                onClick={cellClick(() => act.openSite(site))}
                title="Ouvrir la fiche du site">
                <ContractChip contract={contracts[String(site._id)]} />
              </td>

              <td className="sites-xl-resp" rowSpan={span}
                onClick={cellClick(() => act.editContacts(site))}
                title="Modifier les responsables">
                {site.contacts?.length ? (
                  <div className="resp-stack">
                    {site.contacts.map((c, i) => (
                      <div key={i} className="resp-block">
                        {c.name && <span className="resp-name">{c.name}</span>}
                        {c.phone && <span className="resp-line"><Phone size={10} /> {c.phone}</span>}
                        {c.email && <span className="resp-line"><Mail size={10} /> {c.email}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="site-cell-empty">Aucun responsable</span>
                )}
              </td>
            </>
          )

          if (deas.length === 0) {
            return (
              <tbody key={site._id} className="sites-xl-group">
                <tr className="sites-xl-row"
                  onContextMenu={e => act.siteMenu(e, site)}>
                  {siteCells}
                  <td colSpan={6} className="sites-xl-nodea">
                    <NoDeaBox site={site} act={act} />
                  </td>
                </tr>
              </tbody>
            )
          }

          return (
            <tbody key={site._id} className="sites-xl-group">
              {deas.map((dea, i) => (
                <tr key={dea._id} className="sites-xl-row"
                  onContextMenu={e => act.deaMenu(e, site, dea)}>
                  {i === 0 && siteCells}

                  <td className="dea-td" onClick={cellClick(() => act.editDea(site, dea))}
                    title="Modifier ce DEA">
                    <div className="dea-loc-cell">
                      {deas.length > 1 && <span className="dea-index">{i + 1}</span>}
                      {dea.location || <span className="site-cell-empty">—</span>}
                    </div>
                  </td>

                  <td className="dea-td" onClick={cellClick(() => act.editDea(site, dea))}
                    title="Modifier ce DEA">
                    {dea.deviceType || <span className="site-cell-empty">—</span>}
                    {dea.status === 'a_installer' && (
                      <span className="dea-pending-tag" title="Pose planifiée, pas encore posée">
                        À installer
                      </span>
                    )}
                  </td>

                  <td className="dea-td" onClick={cellClick(() => act.editDea(site, dea))}
                    title="Modifier ce DEA">
                    {dea.serialNumber
                      ? <span className="dea-sn">{dea.serialNumber}</span>
                      : <span className="site-cell-empty">—</span>}
                  </td>

                  <td className="dea-td" onClick={cellClick(() => act.editDea(site, dea))}
                    title="Modifier ce DEA">
                    {dea.installationDate
                      ? <span className="dea-date">{formatDate(dea.installationDate)}</span>
                      : <span className="site-cell-empty">—</span>}
                  </td>

                  {/* L'échéance s'ouvre sur son propre réglage : le calcul
                      automatique se corrige ici, sans quitter la fiche client. */}
                  <td className="dea-td">
                    <NextControlChip dea={dea} onClick={() => act.editControl(site, dea)} />
                  </td>

                  <td className="dea-td">
                    <div className="dea-cell-chips">
                      <ItemsButton kind="batteries"  items={dea.batteries}
                        onClick={() => act.items(site, dea, 'batteries')} />
                      <ItemsButton kind="electrodes" items={dea.electrodes}
                        onClick={() => act.items(site, dea, 'electrodes')} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}

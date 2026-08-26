import { ArrowUpRight } from 'lucide-react'
import { formatDate, ItemsCell, ContractChip, NoDeaBox, NextControlChip } from './siteHelpers'

/**
 * Vue tableau : une ligne par DEA, les colonnes du site fusionnées sur ses DEA.
 *
 * Les colonnes disent l'état du parc, pas l'annuaire : responsable et lieu
 * d'installation se lisent sur la fiche du site, alors que le niveau de
 * batterie et la péremption des électrodes décident d'un appel client — c'est
 * ici qu'ils doivent être lisibles d'un coup d'œil.
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
          <col style={{ width: 175 }} />
          <col style={{ width: 145 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 175 }} />
          <col style={{ width: 175 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="sites-xl-site"><div className="th-inner">Site</div></th>
            <th className="sites-xl-ct"><div className="th-inner">Contrat</div></th>
            <th><div className="th-inner">Type</div></th>
            <th><div className="th-inner">N° de série</div></th>
            <th><div className="th-inner">Installation</div></th>
            <th><div className="th-inner">Prochain contrôle</div></th>
            <th><div className="th-inner">Batteries</div></th>
            <th><div className="th-inner">Électrodes</div></th>
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

                  {/* Le numéro d'ordre suivait le lieu d'installation : il
                      reste utile pour distinguer deux DAE d'un même site. */}
                  <td className="dea-td" onClick={cellClick(() => act.editDea(site, dea))}
                    title="Modifier ce DEA">
                    {deas.length > 1 && <span className="dea-index">{i + 1}</span>}
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
                    <ItemsCell kind="batteries" items={dea.batteries}
                      onClick={() => act.items(site, dea, 'batteries')} />
                  </td>

                  <td className="dea-td">
                    <ItemsCell kind="electrodes" items={dea.electrodes}
                      onClick={() => act.items(site, dea, 'electrodes')} />
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

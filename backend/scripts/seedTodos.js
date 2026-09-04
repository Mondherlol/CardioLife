/**
 * Peuple le suivi (/dev) avec les remarques reçues par mail de CardioLife.
 *
 * Idempotent : chaque tâche est retrouvée par son titre et n'est créée que si
 * elle manque (`$setOnInsert`). Relancer le script n'écrase donc jamais un
 * statut, une note ou une échéance saisis à la main — c'est la condition pour
 * pouvoir le rejouer après avoir ajouté de nouvelles lignes.
 *
 *   node scripts/seedTodos.js
 *
 * Les statuts « fait » ci-dessous ont été constatés dans le code au 04/09/2026.
 * Ils restent à confirmer par un test fonctionnel côté CardioLife.
 */
require('dotenv').config()
const mongoose = require('mongoose')
const Todo = require('../models/Todo')

const d = (iso) => new Date(`${iso}T09:00:00.000Z`)

/* Date du relevé de statut. Les lignes marquées « fait » l'ont été en lisant le
   code ce jour-là : `completedAt` doit le dire, sinon la colonne « Fait le »
   reste vide et personne ne sait de quand date la vérification. */
const VERIFIE_LE = d('2026-09-04')

/** Texte brut vers le HTML simple attendu par la colonne « Réponse ». */
function versHtml(texte) {
  return String(texte || '')
    .split(/\n{2,}/)
    .map(bloc => bloc.trim())
    .filter(Boolean)
    .map(bloc => `<p>${bloc
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/\n/g, '<br>')}</p>`)
    .join('')
}

const M18 = 'Mail du 18/08/2026'
const M21 = 'Mail du 21/08/2026'
const M24 = 'Mail du 24/08/2026'
const M28 = 'Mail du 28/08/2026'
const M31 = 'Mail du 31/08/2026'
const S01 = 'Appel M. Mounir — relayé le 01/09/2026'

const TODOS = [
  /* ── Mail du 18/08/2026 ──────────────────────────────────── */
  {
    title: "Ajouter un DEA à un client existant sans passer par la création de stock",
    category: 'Clients & DEA', priority: 'haute', status: 'todo',
    source: M18, requestedAt: d('2026-08-18'),
    notes: "Parc ancien : des DEA installés depuis 2016 doivent pouvoir être rattachés à un client sans créer d'entrée de stock ni saisir un numéro de série obligatoire.",
  },
  {
    title: "Listes déroulantes pour les types et modèles de défibrillateurs",
    category: 'Clients & DEA', priority: 'normale', status: 'todo',
    source: M18, requestedAt: d('2026-08-18'),
    notes: "Proposer les types et modèles déjà enregistrés au lieu d'une saisie manuelle répétée.",
  },
  {
    title: "Modifier manuellement la date du prochain contrôle depuis la fiche Client",
    category: 'Contrôles', priority: 'normale', status: 'done',
    source: M18, requestedAt: d('2026-08-18'),
    notes: "Le calcul automatique produisait parfois des dates déjà dépassées.\n\nConstaté fait : route PUT /api/sites/:id/deas/:deaId/next-control, et le champ `manualDate` du modèle Intervention empêche le calendrier du contrat de réaligner une date posée à la main.",
  },

  /* ── Mail du 21/08/2026 ──────────────────────────────────── */
  {
    title: "Compte technicien Ahmed : données vides, pas de synchro planning, checklist introuvable",
    category: 'Droits & accès', priority: 'haute', status: 'doing',
    source: M21, requestedAt: d('2026-08-21'),
    notes: "Partiellement traité le 04/09 : le rôle Technicien ne court-circuite plus les permissions, et le préréglage du rôle coche Interventions + Appareils + Consulter le stock.\n\nRESTE À FAIRE : rouvrir la fiche d'Ahmed, resélectionner « Technicien » et enregistrer pour appliquer le préréglage. Puis vérifier avec lui que le planning et la checklist s'affichent.",
  },
  {
    title: "Alerte semestrielle des consommables à remplacer, détaillée par modèle et par type",
    category: 'Stock', priority: 'normale', status: 'todo',
    source: M21, requestedAt: d('2026-08-21'),
    notes: "Nombre total de consommables à remplacer sur le semestre, avec le détail par modèle de DEA et par type de consommable (batteries, électrodes adulte/pédiatrique).",
  },
  {
    title: "Super Admin et Marwa : accès complet et gestion des comptes techniciens sans se connecter à leur place",
    category: 'Droits & accès', priority: 'haute', status: 'done',
    source: M21, requestedAt: d('2026-08-21'),
    notes: "Constaté fait : les rôles Admin et Super Admin passent tous les modules, et le superadmin peut saisir puis clôturer une checklist à la place du technicien — chaque saisie étant tracée à son nom dans l'historique.",
  },

  /* ── Mail du 24/08/2026 ──────────────────────────────────── */
  {
    title: "Permettre à l'administrateur de modifier la checklist après clôture",
    category: 'Checklist', priority: 'haute', status: 'done',
    source: M24, requestedAt: d('2026-08-24'),
    notes: "Constaté fait : bouton de réouverture réservé à l'admin sur une intervention clôturée, et chaque correction est journalisée avec l'ancienne et la nouvelle valeur (`logCorrection`).",
  },
  {
    title: "Synchroniser la checklist avec la fiche client et le planning",
    category: 'Synchronisation', priority: 'haute', status: 'doing',
    source: M24, requestedAt: d('2026-08-24'),
    notes: "Exemple de test fourni : Hôtel X.\n\nConstaté dans le code : `syncFicheToParc` descend les relevés sur la fiche du DAE dès la saisie, `pushFicheToParc` rejoue une correction après clôture. Le planning n'est déplacé qu'à la clôture, volontairement.\n\nÀ FAIRE : rejouer le scénario Hôtel X de bout en bout pour confirmer.",
  },
  {
    title: "Rapport : afficher « Valide » au lieu d'un tiret pour batterie et électrodes conformes",
    category: 'Rapport', priority: 'normale', status: 'done',
    source: M24, requestedAt: d('2026-08-24'),
    notes: "Constaté fait : le rapport affiche « Valide » / « Non valide » via EtatChip.",
  },
  {
    title: "Tableau Client : remplacer « Nom du responsable » et « Lieu d'installation » par l'état batterie et électrodes",
    category: 'Clients & DEA', priority: 'haute', status: 'todo',
    source: M24, requestedAt: d('2026-08-24'),
    notes: "Objectif : voir l'état du DEA directement depuis la liste des clients, pour rappeler vite un client en cas de remplacement. Le détail complet reste accessible en ouvrant le client puis le site.",
  },

  /* ── Mail du 28/08/2026 ──────────────────────────────────── */
  {
    title: "Checklist électrodes : supprimer les lignes « État général » et « Pourcentage »",
    category: 'Checklist', priority: 'normale', status: 'done',
    source: M28, requestedAt: d('2026-08-28'),
    notes: "Constaté fait : la fiche n'affiche plus de champ pourcentage pour les électrodes (le champ `electrodesPct` reste en base pour les visites anciennes, sans être saisissable).",
  },
  {
    title: "Checklist : indiquer si la formation a été effectuée ou reportée",
    category: 'Checklist', priority: 'normale', status: 'done',
    source: M28, requestedAt: d('2026-08-28'),
    notes: "Constaté fait : endpoint PATCH /interventions/:id/formation, états « effectuée » / « reportée ».",
  },
  {
    title: "Rapport : numéro de série dans sa propre colonne, séparé de « Type et marque »",
    category: 'Rapport', priority: 'normale', status: 'done',
    source: M28, requestedAt: d('2026-08-28'),
    notes: "Constaté fait dans InterventionPrintPage : colonne « N° de série » distincte.",
  },
  {
    title: "Rapport : remplacer la colonne « Emplacement » par « Résultat des autotests »",
    category: 'Rapport', priority: 'normale', status: 'done',
    source: M28, requestedAt: d('2026-08-28'),
    notes: "Constaté fait : la colonne affiche « Valide » / « Non valide » selon `fiche.autotests`.",
  },
  {
    title: "Rapport : afficher et permettre de modifier le pourcentage de batterie",
    category: 'Rapport', priority: 'haute', status: 'done',
    source: M28, requestedAt: d('2026-08-28'),
    notes: "Constaté fait : le pourcentage s'affiche avec un code couleur (vert ≥ 80 %, orange ≥ 40 %, rouge en dessous). Modification via la checklist, y compris après clôture en mode correction.",
  },
  {
    title: "Rapport : la colonne « État des électrodes » doit afficher la DLC",
    category: 'Rapport', priority: 'normale', status: 'done',
    source: M28, requestedAt: d('2026-08-28'),
    notes: "Constaté fait : dates de péremption Adulte et Pédiatrie affichées.",
  },
  {
    title: "Rapport : afficher « En bon état » au lieu de « Conforme » pour Armoire / Boîtier",
    category: 'Rapport', priority: 'basse', status: 'done',
    source: M28, requestedAt: d('2026-08-28'),
    notes: "Constaté fait dans InterventionPrintPage.",
  },
  {
    title: "« Déclarer un remplacement » d'électrodes ne déclenche aucune action",
    category: 'Remplacements', priority: 'haute', status: 'todo',
    source: M28, requestedAt: d('2026-08-28'),
    notes: "Signalé deux fois : mails du 28/08 et du 31/08. Toujours ouvert — à reproduire depuis la checklist, section Électrodes, bouton « Déclarer un remplacement ».",
  },
  {
    title: "Reprendre les points envoyés par WhatsApp, restés non traités",
    category: 'Divers', priority: 'haute', status: 'todo',
    source: M28, requestedAt: d('2026-08-28'),
    notes: "Le mail du 28/08 rappelle que des points transmis par WhatsApp n'ont pas été réglés, sans les rappeler. À FAIRE : demander la liste à Marwa et créer une tâche par point.",
  },

  /* ── Mail du 31/08/2026 ──────────────────────────────────── */
  {
    title: "Les autorisations utilisateurs ne sont pas respectées (Farah accède au Stock)",
    category: 'Droits & accès', priority: 'haute', status: 'done',
    source: M31, requestedAt: d('2026-08-31'),
    notes: "Corrigé le 04/09/2026. Le menu ne filtrait que sur le rôle et ignorait les permissions ; il n'y avait aucun garde de route (l'URL /stock restait accessible) et six routes API n'avaient aucun contrôle.\n\nUne source de vérité unique a été mise en place (src/lib/access.js et son miroir backend/middleware/access.js) : menu, routes React et routes Express lisent le même tableau.",
  },
  {
    title: "Impossible de déclarer un remplacement de consommable",
    category: 'Remplacements', priority: 'haute', status: 'todo',
    source: M31, requestedAt: d('2026-08-31'),
    notes: "Même sujet que le point du 28/08 sur les électrodes. À traiter ensemble.",
  },
  {
    title: "Rapport final : le niveau de batterie ne s'affiche toujours pas",
    category: 'Rapport', priority: 'haute', status: 'doing',
    source: M31, requestedAt: d('2026-08-31'),
    notes: "Le code du rapport affiche bien `fiche.batteriePct`. Si le niveau reste vide, la cause est en amont : le pourcentage n'est pas enregistré dans la checklist.\n\nÀ FAIRE : vérifier sur une intervention réelle si `batteriePct` est bien saisi et transmis.",
  },
  {
    title: "Rapport : remplacer « Observation générale » par « Recommandation »",
    category: 'Rapport', priority: 'normale', status: 'doing',
    source: M31, requestedAt: d('2026-08-31'),
    notes: "Fait à moitié. La checklist dit bien « Recommandation », mais le rapport imprimé affiche encore « Observation générale » (InterventionPrintPage.jsx, ligne 329).\n\nÀ FAIRE : corriger le libellé du rapport.",
  },
  {
    title: "Checklist : afficher automatiquement la date d'installation du DEA",
    category: 'Checklist', priority: 'normale', status: 'done',
    source: M31, requestedAt: d('2026-08-31'),
    notes: "Constaté fait : champ « Date d'installation » présent dans la fiche.",
  },
  {
    title: "Clarifier ce que recouvre l'accès total (donne-t-il accès aux Paramètres ?)",
    category: 'Droits & accès', priority: 'normale', status: 'done',
    source: M31, requestedAt: d('2026-08-31'),
    notes: "Réponse au 04/09/2026 : OUI. Le rôle Administrateur ouvre tous les modules, Paramètres compris, et les cases de permissions ne s'y appliquent pas — l'écran le dit désormais explicitement.\n\nPour un accès complet SANS les Paramètres, garder un rôle métier (Commercial, Assistante) et cocher les modules un par un en laissant « Gérer les utilisateurs » décoché.",
  },
  {
    title: "Rubrique Formation : ajouter le tableau récapitulatif fourni en pièce jointe",
    category: 'Formations', priority: 'normale', status: 'todo',
    source: M31, requestedAt: d('2026-08-31'),
    notes: "Le modèle du tableau est en pièce jointe du mail du 31/08. À FAIRE : récupérer la PJ et la joindre à cette tâche.",
  },

  /* ── Appel M. Mounir, relayé le 01/09/2026 ───────────────── */
  {
    title: "Bon d'intervention par client, avec nature du passage et signature",
    category: 'Rapport', priority: 'haute', status: 'done',
    source: S01, requestedAt: d('2026-09-01'),
    notes: "Doit contenir : nom du client, modèle, n° de série, date, nature (contrôle semestriel, contrôle annuel, remplacement de consommables, installation, intervention hors délai) et signature du client.\n\nConstaté fait : page dédiée /interventions/:id/bon, les cinq natures sont proposées et la nature est pré-remplie depuis le type de contrôle du contrat.",
  },
  {
    title: "Tableau des clients : ajouter une colonne « Pack » (avec / sans pack)",
    category: 'Clients & DEA', priority: 'normale', status: 'todo',
    source: S01, requestedAt: d('2026-09-01'),
    notes: "Identifier d'un coup d'œil les clients ayant souscrit un pack.",
  },
]

async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  let crees = 0
  let existants = 0

  for (const [i, t] of TODOS.entries()) {
    const { notes, ...reste } = t
    /* Le tableau sépare la demande de la réponse. Sur une ligne déjà traitée,
       la note EST le compte rendu : elle va en « Réponse ». Sur une ligne
       encore à faire, elle précise la demande et reste dans « Notes ». */
    const compteRendu = t.status !== 'todo'

    const res = await Todo.updateOne(
      { title: t.title },
      {
        $setOnInsert: {
          ...reste,
          notes:    compteRendu ? '' : notes,
          response: compteRendu ? versHtml(notes) : '',
          position: i,
          ...(t.status === 'done' ? { completedAt: VERIFIE_LE } : {}),
        },
      },
      { upsert: true }
    )
    if (res.upsertedCount) crees++
    else existants++
  }

  /* Rattrapage des lignes insérées avant l'ajout de `completedAt` ci-dessus :
     on ne touche qu'aux tâches faites qui n'en ont aucune. */
  const rattrape = await Todo.updateMany(
    { status: 'done', completedAt: { $in: [null, undefined] } },
    { $set: { completedAt: VERIFIE_LE } }
  )

  console.log(`${crees} tâche(s) créée(s), ${existants} déjà présente(s) et laissée(s) intactes.`)
  if (rattrape.modifiedCount) console.log(`${rattrape.modifiedCount} date(s) d'achèvement complétée(s).`)
  await mongoose.disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

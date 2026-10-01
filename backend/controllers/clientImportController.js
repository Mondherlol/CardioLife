const multer          = require('multer')
const XLSX            = require('xlsx')
const Client          = require('../models/Client')
const Site            = require('../models/Site')
const Contract        = require('../models/Contract')
const Product         = require('../models/Product')
const ProductCategory = require('../models/ProductCategory')
const ProductItem     = require('../models/ProductItem')
const Intervention    = require('../models/Intervention')
const { seedIfEmpty } = require('./productCategoriesController')
const { resetBusinessData } = require('../utils/resetData')
const { syncDeaWithItem, syncProductStock, attachMountedParts } = require('../utils/productItems')
const { addMonths, skipWeekend, syncSiteNextControl, PERIOD_MONTHS } = require('../utils/controls')

/**
 * Import Excel du parc, aligné sur la structure Client → Site → DAE.
 *
 * Une ligne décrit un DAE ; les colonnes client et site se répètent d'une
 * ligne à l'autre. Les fichiers réels ne sont jamais aussi sages : un même
 * appareil revient sur plusieurs lignes (une par vente de consommables), deux
 * sites homonymes sont à deux adresses différentes, les numéros de série et
 * les modèles s'écrivent de dix façons. L'import se fait donc en trois temps,
 * partagés par la lecture à blanc et l'import réel :
 *
 *  1. `normalizeRow` nettoie chaque ligne : textes, téléphones, emails, dates
 *     réparées quand c'est sans ambiguïté, n° de série et modèles ramenés à
 *     leur forme canonique. Une valeur illisible est ignorée et signalée ; elle
 *     ne fait plus tomber toute la ligne.
 *  2. `consolidate` regroupe : clients, puis sites (séparés par adresse,
 *     variantes de nom regroupées), puis DAE (un n° de série = un appareil,
 *     ses consommables fusionnés sur toutes les lignes qui le citent).
 *  3. Le rapport d'analyse dit tout ce qui a été corrigé, fusionné, ignoré,
 *     et ce qui reste à vérifier dans le fichier.
 *
 * `validate` joue ces trois étapes et rend l'aperçu ; `execute` les rejoue sur
 * les lignes retenues, avec les décisions prises à l'écran (modèles à créer ou
 * rattacher, clients à regrouper), puis écrit clients, sites, DAE, contrats,
 * stock et planning.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') ||
               file.mimetype.includes('excel') ||
               file.mimetype.includes('csv') ||
               file.originalname.match(/\.(xlsx|xls|csv)$/i)
    cb(null, !!ok)
  },
}).single('file')

/* ── En-tête Excel → clé interne ────────────────────────────────
   Les libellés sont normalisés avant recherche (sans accent, sans apostrophe
   ni ponctuation) : « Date d'installation », « DATE INSTALLATION » et
   « date_installation » tombent sur la même entrée. Un en-tête inconnu est
   ensuite rapproché par ressemblance, et le rapport de lecture dit dans quelle
   colonne chaque champ a été trouvé. */
const COL_MAP = {
  /* ── Client ── */
  'client':                 'name',
  'nom':                    'name',
  'nom du client':          'name',
  'nom client':             'name',
  'raison sociale':         'name',
  'societe':                'name',
  'name':                   'name',
  'client adresse':         'clientStreet',
  'client rue':             'clientStreet',
  'adresse client':         'clientStreet',
  'client ville':           'clientCity',
  'ville client':           'clientCity',
  'client gouvernorat':     'clientGovernorate',
  'gouvernorat client':     'clientGovernorate',
  'sous contrat':           'underContract',
  'contrat':                'underContract',
  'contrat de maintenance': 'underContract',
  'sous contrat de maintenance': 'underContract',
  'forfait contrat':        'contractPrice',
  'forfait du contrat':     'contractPrice',
  'forfait':                'contractPrice',
  'prix contrat':           'contractPrice',
  'prix du contrat':        'contractPrice',
  'montant du contrat':     'contractPrice',
  'notes':                  'notes',
  'remarques':              'notes',
  'commentaire':            'notes',
  'commentaires':           'notes',

  /* ── Site ── */
  'site':                   'siteName',
  'nom du site':            'siteName',
  'nom site':               'siteName',
  'site nom':               'siteName',
  'nom de l agence':        'siteName',
  'agence':                 'siteName',
  'site adresse':           'siteStreet',
  'site rue':               'siteStreet',
  'adresse du site':        'siteStreet',
  'site ville':             'siteCity',
  'ville du site':          'siteCity',
  'site gouvernorat':       'siteGovernorate',
  'gouvernorat du site':    'siteGovernorate',
  'site notes':             'siteNotes',
  'pack':                   'sitePack',
  'site pack':              'sitePack',
  'pack securite':          'sitePack',
  'responsable':                'siteContactName',
  'responsable du site':        'siteContactName',
  'responsable site':           'siteContactName',
  'nom du responsable':         'siteContactName',
  'contact':                    'siteContactName',
  'personne a contacter':       'siteContactName',
  'responsable nom':            'siteContactName',
  'site responsable':           'siteContactName',
  'site responsable nom':       'siteContactName',
  'responsable telephone':      'siteContactPhone',
  'telephone du responsable':   'siteContactPhone',
  'num de telephone':           'siteContactPhone',
  'numero de telephone':        'siteContactPhone',
  'n de telephone':             'siteContactPhone',
  'tel':                        'siteContactPhone',
  'gsm':                        'siteContactPhone',
  'mobile':                     'siteContactPhone',
  'portable':                   'siteContactPhone',
  'contact telephone':          'siteContactPhone',
  'site responsable telephone': 'siteContactPhone',
  'responsable email':          'siteContactEmail',
  'email du responsable':       'siteContactEmail',
  'adresse email':              'siteContactEmail',
  'mail':                       'siteContactEmail',
  'courriel':                   'siteContactEmail',
  'contact email':              'siteContactEmail',
  'site responsable email':     'siteContactEmail',

  /* ── DAE ── */
  'type dea':               'deaType',
  'type dae':               'deaType',
  'dae type':               'deaType',
  'dea type':               'deaType',
  'type de dae':            'deaType',
  'type de dea':            'deaType',
  'type d appareil':        'deaType',
  'modele':                 'deaType',
  'modele dae':             'deaType',
  'modele dea':             'deaType',
  'modele du dae':          'deaType',
  'dae modele':             'deaType',
  'appareil':               'deaType',
  'serial number':          'deaSerial',
  'serial':                 'deaSerial',
  'sn':                     'deaSerial',
  's n':                    'deaSerial',
  'numero de serie':        'deaSerial',
  'numero serie':           'deaSerial',
  'n de serie':             'deaSerial',
  'n serie':                'deaSerial',
  'dae numero de serie':    'deaSerial',
  'dea numero de serie':    'deaSerial',
  'dae n serie':            'deaSerial',
  'serie du dae':           'deaSerial',
  'emplacement':            'deaLocation',
  'dae emplacement':        'deaLocation',
  'localisation':           'deaLocation',
  'lieu':                   'deaLocation',
  'position':               'deaLocation',
  'date d installation':    'deaInstallDate',
  'date installation':      'deaInstallDate',
  'date de pose':           'deaInstallDate',
  'date de mise en service':'deaInstallDate',
  'installation':           'deaInstallDate',
  'dae date installation':  'deaInstallDate',
  'dae statut':             'deaStatus',
  'statut':                 'deaStatus',
  'statut du dae':          'deaStatus',
  'etat':                   'deaStatus',
  'type de controle':       'deaControlType',
  'dae type de controle':   'deaControlType',
  'periodicite':            'deaControlType',
  'periodicite des controles': 'deaControlType',
  'prochain controle':      'deaNextControl',
  'date prochain controle': 'deaNextControl',
  'dae prochain controle':  'deaNextControl',
  'prochaine visite':       'deaNextControl',
  'dernier controle':       'deaLastControl',
  'date dernier controle':  'deaLastControl',
  'derniere visite':        'deaLastControl',
  'date de la derniere visite': 'deaLastControl',
  'dae dernier controle':   'deaLastControl',
  'dae notes':              'deaNotes',
  'notes dae':              'deaNotes',

  /* ── Armoire ── */
  'type armoire':           'armoireModel',
  'type d armoire':         'armoireModel',
  'type de l armoire':      'armoireModel',
  'modele armoire':         'armoireModel',
  'armoire type':           'armoireModel',
  'armoire modele':         'armoireModel',
  'armoire':                'armoireModel',
  'pile armoire':           'armoirePiles',
  'piles armoire':          'armoirePiles',
  'armoire pile':           'armoirePiles',
  'armoire piles':          'armoirePiles',
  'piles de l armoire':     'armoirePiles',
  'etat piles armoire':     'armoirePiles',
  'etat des piles':         'armoirePiles',

  /* ── Batterie ── */
  'batterie numero de serie': 'battSerial',
  'batterie n serie':         'battSerial',
  'numero de serie batterie': 'battSerial',
  'batterie lot':             'battLot',
  'batterie numero de lot':   'battLot',
  'lot batterie':             'battLot',
  'batterie modele':          'battProductName',
  'modele batterie':          'battProductName',
  'type de batterie':         'battProductName',
  'type batterie':            'battProductName',
  'installation batterie':    'battActivation',
  'date installation batterie': 'battActivation',
  'batterie installation':    'battActivation',
  'batterie activation':      'battActivation',
  'activation batterie':      'battActivation',
  'mise en service batterie': 'battActivation',
  'batterie dlc':             'battExpiry',
  'dlc batterie':             'battExpiry',
  'batterie date expiration': 'battExpiry',
  'batterie expiration':      'battExpiry',
  'batterie peremption':      'battExpiry',
  'peremption batterie':      'battExpiry',
  'date expiration batterie': 'battExpiry',
  'batterie charge':          'battLevel',
  'charge batterie':          'battLevel',
  'batterie niveau':          'battLevel',
  'niveau batterie':          'battLevel',
  'niveau de batterie':       'battLevel',
  'niveau de charge':         'battLevel',
  'charge':                   'battLevel',

  /* ── Électrodes ──
     Deux façons de les décrire : une colonne de DLC par type d'électrodes
     (« Electrode », « Electrode RCP », « Electrode P »…), ou bien une DLC et
     un type en toutes lettres. Les deux se lisent. */
  'electrode':                  'elecAdultExpiry',
  'electrodes':                 'elecAdultExpiry',
  'electrode adulte':           'elecAdultExpiry',
  'electrodes adulte':          'elecAdultExpiry',
  'dlc electrodes adulte':      'elecAdultExpiry',
  'electrode rcp':              'elecCprExpiry',
  'electrodes rcp':             'elecCprExpiry',
  'electrode adulte rcp':       'elecCprExpiry',
  'electrodes capteur rcp':     'elecCprExpiry',
  'electrode universelle':      'elecUniversalExpiry',
  'electrodes universelles':    'elecUniversalExpiry',
  'electrode p':                'elecChildExpiry',
  'electrodes p':               'elecChildExpiry',
  'electrode pediatrique':      'elecChildExpiry',
  'electrodes pediatriques':    'elecChildExpiry',
  'electrode enfant':           'elecChildExpiry',
  'electrodes enfant':          'elecChildExpiry',
  'dlc electrodes pediatriques':'elecChildExpiry',
  'electrodes type':            'elecKind',
  'type electrodes':            'elecKind',
  'type d electrodes':          'elecKind',
  'electrodes modele':          'elecProductName',
  'modele electrodes':          'elecProductName',
  'electrodes lot':             'elecLot',
  'electrodes numero de lot':   'elecLot',
  'lot electrodes':             'elecLot',
  'dlc electrodes':             'elecExpiry',
  'electrodes dlc':             'elecExpiry',
  'electrodes date expiration': 'elecExpiry',
  'electrodes expiration':      'elecExpiry',
  'electrodes peremption':      'elecExpiry',
  'peremption electrodes':      'elecExpiry',
  'date expiration electrodes': 'elecExpiry',

  /* ── Colonnes sans préfixe : elles valent pour le site, et servent de repli
        pour l'adresse du client quand celui-ci n'a pas la sienne. ── */
  'adresse':    'street',
  'rue':        'street',
  'street':     'street',
  'ville':      'city',
  'city':       'city',
  'gouvernorat':'governorate',
  'governorat': 'governorate',
  'region':     'governorate',
  'telephone':  'siteContactPhone',
  'phone':      'siteContactPhone',
  'email':      'siteContactEmail',
  'e mail':     'siteContactEmail',
}

/* Libellés des champs, pour le rapport de lecture affiché avant l'import. */
const FIELD_LABELS = {
  name: 'Client', clientStreet: 'Adresse du client', clientCity: 'Ville du client',
  clientGovernorate: 'Gouvernorat du client', underContract: 'Sous contrat', notes: 'Notes du client',
  contractPrice: 'Forfait du contrat',
  siteName: 'Nom du site', siteStreet: 'Adresse du site', siteCity: 'Ville du site',
  siteGovernorate: 'Gouvernorat du site', siteNotes: 'Notes du site', sitePack: 'Pack',
  siteContactName: 'Responsable du site', siteContactPhone: 'Téléphone du responsable',
  siteContactEmail: 'Email du responsable',
  street: 'Adresse (site + client)', city: 'Ville (site + client)', governorate: 'Gouvernorat (site + client)',
  deaType: 'Modèle du DAE', deaSerial: 'N° de série du DAE', deaLocation: 'Emplacement',
  deaInstallDate: "Date d'installation", deaStatus: 'Statut du DAE', deaControlType: 'Type de contrôle',
  deaNextControl: 'Prochain contrôle', deaLastControl: 'Dernier contrôle', deaNotes: 'Notes du DAE',
  armoireModel: "Type d'armoire", armoirePiles: "Piles de l'armoire",
  battSerial: 'N° de série de la batterie', battLot: 'N° de lot de la batterie',
  battProductName: 'Modèle de batterie', battActivation: 'Installation de la batterie',
  battExpiry: 'DLC batterie', battLevel: 'Charge batterie',
  elecAdultExpiry: 'DLC électrodes adulte', elecCprExpiry: 'DLC électrodes adulte RCP',
  elecUniversalExpiry: 'DLC électrodes universelles', elecChildExpiry: 'DLC électrodes pédiatriques',
  elecKind: "Type d'électrodes", elecProductName: "Modèle d'électrodes", elecLot: 'Lot électrodes',
  elecExpiry: 'DLC électrodes',
}

/* Colonnes qui décrivent un appareil. Les dates de contrôle n'en font pas
   partie : une visite concerne le site, pas un DAE en particulier. */
const DEVICE_KEYS = [
  'deaType', 'deaSerial', 'deaLocation', 'deaInstallDate', 'deaStatus', 'deaControlType', 'deaNotes',
  'battSerial', 'battLot', 'battProductName', 'battActivation', 'battExpiry', 'battLevel',
  'elecKind', 'elecProductName', 'elecLot', 'elecExpiry',
  'elecAdultExpiry', 'elecCprExpiry', 'elecUniversalExpiry', 'elecChildExpiry',
  'armoireModel', 'armoirePiles',
]

const DATE_FIELDS = [
  'deaInstallDate', 'deaNextControl', 'deaLastControl', 'battActivation', 'battExpiry',
  'elecExpiry', 'elecAdultExpiry', 'elecCprExpiry', 'elecUniversalExpiry', 'elecChildExpiry',
]

const DEFAULT_SITE_NAME = 'Site principal'
const DEA_CATEGORY      = 'defibrillateurs'
/* Horizon de planification par défaut : la visite qui vient, et celle d'après
   si elle tombe dans l'année. */
const DEFAULT_HORIZON_MONTHS = 12

const BROKEN_NOTE = 'Signalé en panne dans le fichier de suivi.'
const CLOSED_NOTE = 'Site signalé fermé dans le fichier de suivi.'

/* Marques reconnues dans un libellé de modèle inconnu, pour préremplir la
   fiche du produit créé à l'import. */
const BRANDS = [
  'Powerheart', 'Cardiac Science', 'Zoll', 'Defibtech', 'Philips', 'HeartSine',
  'Physio-Control', 'Schiller', 'Mindray', 'Nihon Kohden', 'Primedic', 'Metrax',
  'Cardiolife', 'Lifepak', 'Samaritan', 'Saver One', 'Progetti', 'Bexen', 'Mediana',
]

/* ── Modèles connus ─────────────────────────────────────────────
   Le parc tient en une quinzaine de modèles, écrits de toutes les façons :
   « POWERHEAR G5 », « POWERHEARTG3 », « ZOLL AED AED3 ». Chacun est ramené à
   un libellé unique — c'est ce libellé qui devient le produit du catalogue.
   `family` relie un appareil à ses consommables (une batterie G5 sur un G3
   est une erreur de saisie). Le « S » final des Powerheart G5 et ZOLL AED Plus
   désigne la version semi-automatique. */
const MODELS = [
  { label: 'Powerheart G5', brand: 'Cardiac Science', mode: 'automatique', family: 'g5',
    aliases: ['powerheart g5', 'powerhear g5', 'powerheart g5 automatique', 'g5'] },
  { label: 'Powerheart G5 semi-automatique', brand: 'Cardiac Science', mode: 'semi-automatique', family: 'g5',
    aliases: ['powerheart g5s', 'powerhear g5s', 'powerheart g5 s', 'powerheart g5 semi',
      'powerheart g5 semi automatique', 'g5s', 'g5 semi'] },
  { label: 'Powerheart G3', brand: 'Cardiac Science', family: 'g3',
    aliases: ['powerheart g3', 'powerhear g3', 'powerheart g3 plus', 'g3'] },
  { label: 'ZOLL AED Plus', brand: 'ZOLL', mode: 'automatique', family: 'zoll-plus',
    aliases: ['zoll aed plus', 'zoll aed plus automatique', 'aed plus', 'zoll zeda plus'] },
  { label: 'ZOLL AED Plus semi-automatique', brand: 'ZOLL', mode: 'semi-automatique', family: 'zoll-plus',
    aliases: ['zoll aed plus s', 'zoll aed plus semi', 'zoll aed plus semi automatique', 'zoll semi'] },
  { label: 'ZOLL AED 3', brand: 'ZOLL', family: 'zoll-3',
    aliases: ['zoll aed 3', 'zoll aed3', 'zoll aed aed3', 'aed 3', 'aed3'] },
  { label: 'Mediana',      brand: 'Mediana',        aliases: ['mediana'] },
  { label: 'Schiller',     brand: 'Schiller',       aliases: ['schiller'] },
  { label: 'Lifepak',      brand: 'Physio-Control', aliases: ['lifepak', 'life pak', 'life pack'] },
  { label: 'Lifeline',     brand: 'Defibtech',      aliases: ['lifeline', 'life line'] },
  { label: 'Reanibex 100', brand: 'Bexen',          aliases: ['reanibex 100'] },
  { label: 'Reanibex 200', brand: 'Bexen',          aliases: ['reanibex 200'] },
  { label: 'Reanibex 800', brand: 'Bexen',          aliases: ['reanibex 800'] },
]

const BATTERIES = [
  { label: 'Batterie Intellisense G5', family: 'g5',
    aliases: ['intellisense g5', 'batterie intellisense g5', 'batterie g5', 'batterie lithium g5'] },
  { label: 'Batterie Intellisense G3', family: 'g3',
    aliases: ['intellisense g3', 'batterie intellisense g3', 'batterie g3', 'batterie lithium g3'] },
  { label: 'Piles CR123A', family: 'zoll-plus',
    aliases: ['pile cr123', 'piles cr123', 'pile cr123a', 'piles cr123a', 'cr123', 'cr123a', 'duracell cr123a'] },
]

/* Pièces montées sur les DAE — batteries, électrodes, armoires. Elles entrent
   au catalogue comme les modèles d'appareils, et chaque DAE pointe vers les
   siennes. Une batterie ou des électrodes ne vont que sur une famille
   d'appareils : leur nom porte cette famille (les G5 automatique et
   semi-automatique partagent les mêmes). */
const FAMILY_LABELS = { g5: 'Powerheart G5', g3: 'Powerheart G3', 'zoll-plus': 'ZOLL AED Plus', 'zoll-3': 'ZOLL AED 3' }
const ELECTRODE_LABELS = {
  adulte:      'Électrodes adulte',
  rcp:         'Électrodes adulte avec capteur RCP',
  universelle: 'Électrodes universelles',
  enfant:      'Électrodes pédiatriques',
}
const PART_CATEGORIES = { batteries: 'batteries', electrodes: 'electrodes', armoires: 'armoires' }

/** Famille d'appareils d'un modèle, telle qu'elle se lit dans le nom d'une pièce. */
function partsFamily(model) {
  const m = canonicalModel(model)
  return { label: FAMILY_LABELS[m.family] || m.label || '', brand: m.brand || '' }
}

function electrodeName(type, model) {
  const { label } = partsFamily(model)
  return label ? `${ELECTRODE_LABELS[type]} ${label}` : ELECTRODE_LABELS[type]
}

const armoireProductName = model => (model ? `Armoire ${model}` : '')

/* Armoires du parc : ramenées à un libellé unique, comme les modèles de DAE. */
const ARMOIRES = [
  { label: 'AIVIA 100', aliases: ['aivia 100', 'aivia100'] },
  { label: 'AIVIA S',   aliases: ['aivia s'] },
  { label: 'AIVIA IN',  aliases: ['aivia in', 'aivia indoor'] },
]

/* Piles de l'alarme de l'armoire : ce que le fichier écrit → état du parc. */
const PILES_TO_REPLACE = new Set([
  'epuise', 'epuisee', 'epuisees', 'epuises', 'a remplacer', 'remplacer', 'a changer', 'faible',
  'faibles', 'hs', 'vide', 'vides', 'morte', 'mortes', 'non conforme', 'nc', 'non', 'ko',
])
const PILES_OK = new Set([
  'ok', 'bon', 'bonne', 'bonnes', 'bons', 'bon etat', 'neuve', 'neuves', 'conforme', 'conformes',
  'oui', 'remplace', 'remplacee', 'remplacees', 'change', 'changee', 'changees', 'en etat',
])
const PILES_LABELS = { ok: 'en état', a_remplacer: 'à remplacer' }

const GOVERNORATES = [
  'Tunis', 'Ariana', 'Ben Arous', 'Manouba', 'Nabeul', 'Zaghouan', 'Bizerte', 'Béja',
  'Jendouba', 'Le Kef', 'Siliana', 'Sousse', 'Monastir', 'Mahdia', 'Sfax', 'Kairouan',
  'Kasserine', 'Sidi Bouzid', 'Gabès', 'Médenine', 'Tataouine', 'Gafsa', 'Tozeur', 'Kébili',
]
const GOVERNORATE_ALIASES = { 'kef': 'Le Kef', 'la manouba': 'Manouba', 'mednine': 'Médenine', 'jandouba': 'Jendouba' }

/* Coquilles et noms abrégés de villes relevés dans les fichiers de suivi. */
const CITY_FIXES = {
  'douze': 'Douz', 'ennfidha': 'Enfidha', 'hammem sousse': 'Hammam Sousse',
  'marsa': 'La Marsa', 'kram': 'Le Kram', 'rades': 'Radès', 'haouaria': 'El Haouaria',
}
const CITY_CENTER = new Set(['c ville', 'centre ville'])

/* Un « responsable » qui n'est qu'une fonction : on la range comme telle. */
const ROLE_WORDS = new Set([
  'infirmiere', 'infirmier', 'infirmerie', 'assistante', 'assistant', 'secretaire', 'secretariat',
  'reception', 'accueil', 'standard', 'direction', 'comptabilite', 'rh',
])

/* Extensions d'email courantes : au-delà, une adresse comme
   « riahi.267@emea.teleper » est une adresse tronquée à la saisie. */
const EMAIL_TLDS = new Set((
  'com net org info biz tn fr ch fi de be it es nl eu uk co io int gov edu ma dz ly us ca lu at pt ' +
  'se no dk pl tr gr ae qa sa africa online site store tech group global email me tv app dev pro ' +
  'travel health hotel hotels bank'
).split(' '))
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.([a-z]{2,})$/i

/* Domaines de messagerie grand public : ils ne disent rien de l'employeur. */
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.fr', 'yahoo.com', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr',
  'live.fr', 'live.com', 'gnet.tn', 'topnet.tn', 'planet.tn', 'icloud.com',
])

/* Mots qui ne suffisent pas à rapprocher deux clients. */
const GENERIC_WORDS = new Set([
  'h', 'hotel', 'hotels', 'ste', 'societe', 'the', 'le', 'la', 'les', 'el', 'de', 'du', 'des', 'd', 'l',
  'et', 'centre', 'ecole', 'lycee', 'club', 'groupe', 'group', 'ambassade', 'ministere', 'institut',
  'hopital', 'clinique', 'parc', 'site', 'bank', 'banque', 'medical', 'pharma', 'sa', 'sarl', 'suarl',
  'tunisie', 'tunisia', 'international', 'services', 'service', 'company', 'general', 'technologies',
  'palace', 'beach', 'palm', 'resort', 'royal', 'golf', 'spa', 'garden', 'plaza', 'club', 'marina',
  ...GOVERNORATES.flatMap(g => keyOf(g).split(' ')),
  'djerba', 'hammamet', 'tabarka', 'marsa', 'kram', 'douz', 'lac', 'skanes', 'gammarth', 'carthage',
  'kantaoui', 'yasmine', 'medina',
])

/* ── Petits utilitaires ──────────────────────────────────────── */

function normalizeText(str) {
  return String(str ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')   // accents décomposés par NFD
    .replace(/\s+/g, ' ')
}

/** Clé de regroupement : sans accent, sans ponctuation, espaces réduits. */
function keyOf(str) {
  return normalizeText(str).replace(/[^a-z0-9]+/g, ' ').trim()
}

/** En-tête ramené à sa forme canonique : sans accent ni ponctuation. */
function normalizeHeader(h) {
  return normalizeText(h)
    .replace(/[°.'’`_\-/\\(),;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Regex d'égalité insensible à la casse et aux espaces de bord. */
function exactRe(value) {
  return { $regex: `^${escapeRegex(String(value).trim())}$`, $options: 'i' }
}

/** Texte d'une cellule : espaces insécables, tabulations et doublons réduits. */
function cleanText(v) {
  if (v == null) return ''
  return String(v).replace(/[ \t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Nom propre (client, site) : « CONSEIL DE L' EUROPE » → « CONSEIL DE L'EUROPE ». */
function cleanName(v) {
  return cleanText(v)
    .replace(/\s*(['’])\s*/g, "'")
    .replace(/\s*\/\s*/g, '/')
    .replace(/^[\s.,;:-]+|[\s,;:-]+$/g, '')
}

const isUpper = s => /\p{L}/u.test(s) && s === s.toUpperCase()

function titleCase(s) {
  return String(s).toLocaleLowerCase('fr')
    .replace(/(^|[\s\-'’./])(\p{L})/gu, (_m, p, c) => p + c.toLocaleUpperCase('fr'))
}

const byRow  = (a, b) => (a._row || 0) - (b._row || 0)
const uniq   = list => [...new Set(list)]
const maxStr = list => list.filter(Boolean).sort().at(-1) || ''
const minStr = list => list.filter(Boolean).sort()[0] || ''

/** Valeur la plus fréquente ; à égalité, la première rencontrée. */
function mostFrequent(values) {
  const counts = new Map()
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1)
  let best = '', n = 0
  for (const [v, c] of counts) if (c > n) { best = v; n = c }
  return best
}

/* Ressemblance entre deux textes : coefficient de Dice sur les bigrammes. */
function bigrams(str) {
  const s = ` ${str} `
  const out = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}

function similarity(a, b) {
  const x = normalizeText(a)
  const y = normalizeText(b)
  if (!x || !y) return 0
  if (x === y) return 1

  const A = bigrams(x)
  const B = bigrams(y)
  const pool = new Map()
  A.forEach(g => pool.set(g, (pool.get(g) || 0) + 1))
  let hits = 0
  for (const g of B) {
    const n = pool.get(g) || 0
    if (n > 0) { pool.set(g, n - 1); hits++ }
  }
  const dice = (2 * hits) / (A.length + B.length)

  /* Un texte contenu dans l'autre se ressemble d'autant plus qu'il en couvre
     une grande part : « Powerheart G5 » dans « Powerheart G5 Automatique »
     compte, la lettre « a » dans « raison sociale » non. */
  if (x.includes(y) || y.includes(x)) {
    const ratio = Math.min(x.length, y.length) / Math.max(x.length, y.length)
    return Math.max(dice, 0.5 + 0.45 * ratio)
  }
  return dice
}

/** Distance d'édition — sert à repérer deux n° de série qui n'en font qu'un. */
function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/** « a » figure-t-il dans « b » comme suite de mots entiers ? */
function containsWords(big, small) {
  return !!small && big !== small && ` ${big} `.includes(` ${small} `)
}

const pad = n => String(n).padStart(2, '0')
const frDate = iso => (iso ? iso.split('-').reverse().join('/') : '')

/* ── Conversions de cellules ─────────────────────────────────── */

/** Numéro de série Excel → 'aaaa-mm-jj', sans passer par un fuseau horaire. */
function serialToISO(serial) {
  const parsed = XLSX.SSF?.parse_date_code?.(serial)
  if (!parsed || !parsed.y) return null
  return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`
}

function checkedDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return { invalid: true }
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return { invalid: true }   // 31/02
  return { iso: `${y}-${pad(m)}-${pad(d)}` }
}

/**
 * Date d'une cellule → `{ iso }` ('aaaa-mm-jj', '' si vide).
 *
 * Ce qui se répare sans ambiguïté l'est, et le dit (`fixed`) : « 23/011/2017 »
 * (zéro de trop), « 07/102029 » (séparateur oublié), « 28/11/2027 PEDIA »
 * (commentaire accolé). Une année seule (« 2030 ») devient le 1er janvier et
 * le signale (`approx`) : pour une DLC, c'est la lecture prudente. Les mentions
 * « SITE FERME » ou « en panne » glissées dans une colonne de date sont
 * reconnues (`flag`). Le reste est illisible (`invalid`).
 *
 * `order` tranche les dates textuelles ambiguës : '03/09/2026' est le 3
 * septembre en 'dmy', le 9 mars en 'mdy'.
 */
function parseDateCell(value, order = 'dmy') {
  if (value == null || value === '') return { iso: '' }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { invalid: true }
    return { iso: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` }
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 1990 && value <= 2100) return { iso: `${value}-01-01`, approx: value }
    if (value > 0 && value < 300000) {
      const iso = serialToISO(value)
      return iso ? { iso } : { invalid: true }
    }
    return { invalid: true }
  }

  const str = cleanText(value)
  if (!str) return { iso: '' }
  const k = keyOf(str)
  if (/\bferme/.test(k)) return { flag: 'closed' }
  if (/\b(panne|hors service|hs|defectueux|defaillant)\b/.test(k)) return { flag: 'broken' }

  if (/^\d{4}$/.test(str)) {
    const y = Number(str)
    return y >= 1990 && y <= 2100 ? { iso: `${y}-01-01`, approx: y } : { invalid: true }
  }

  // 'aaaa-mm-jj' — jamais ambigu.
  const iso = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/)
  if (iso) return checkedDate(+iso[1], +iso[2], +iso[3])

  let m = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  let fixed = false
  if (!m) { m = str.match(/^(\d{1,2})[/\-.]0(\d{2})[/\-.](\d{4})$/); fixed = !!m }
  if (!m) { m = str.match(/^(\d{1,2})[/\-.](\d{2})(\d{4})$/); fixed = !!m }
  if (!m) { m = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\s+\S.*$/); fixed = !!m }
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    // Une valeur > 12 ne peut être qu'un jour : elle l'emporte sur la convention.
    let day = a, month = b
    if (b > 12 && a <= 12)             { day = b; month = a }
    else if (!(a > 12) && order === 'mdy') { day = b; month = a }
    const out = checkedDate(y, month, day)
    if (out.iso && fixed) out.fixed = true
    return out
  }

  // Numéro de série Excel arrivé sous forme de texte.
  if (/^\d+(\.\d+)?$/.test(str)) {
    const n = Number(str)
    if (n > 20000 && n < 80000) {
      const out = serialToISO(n)
      return out ? { iso: out } : { invalid: true }
    }
  }
  return { invalid: true }
}

/**
 * Convention de date du fichier, lue sur les cellules textuelles.
 *
 * Une seule date dont le premier nombre dépasse 12 suffit à trancher : ce ne
 * peut être qu'un jour. Sans indice, on reste sur jj/mm/aaaa — la convention
 * française — et l'écran d'import le dit clairement.
 */
function detectDateOrder(rows) {
  let dmy = 0, mdy = 0
  for (const row of rows) {
    for (const key of DATE_FIELDS) {
      const v = row[key]
      if (typeof v !== 'string') continue
      const m = v.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
      if (!m) continue
      const a = Number(m[1]), b = Number(m[2])
      if (a > 12 && b <= 12) dmy++
      else if (b > 12 && a <= 12) mdy++
    }
  }
  if (mdy > dmy) return { order: 'mdy', certain: true }
  if (dmy > 0)   return { order: 'dmy', certain: true }
  return { order: 'dmy', certain: false }
}

function toBool(value) {
  const v = normalizeText(value)
  if (!v) return undefined
  if (['oui', 'yes', 'true', 'vrai', '1', 'x', 'sous contrat', 'o'].includes(v)) return true
  if (['non', 'no', 'false', 'faux', '0', 'sans contrat', 'n'].includes(v)) return false
  return null   // valeur non reconnue
}

/**
 * Charge de la batterie en pourcentage. Excel range « 50 % » en 0,5 : une
 * fraction est donc remontée à l'échelle, un entier lu tel quel.
 */
function toPercent(value) {
  if (value === '' || value == null) return undefined
  if (typeof value === 'number') {
    return value > 0 && value <= 1 ? Math.round(value * 100) : value
  }
  const str = String(value).trim().replace('%', '').replace(',', '.').trim()
  if (!str) return undefined
  const n = Number(str)
  if (Number.isNaN(n)) return null
  return n > 0 && n <= 1 && String(str).includes('.') ? Math.round(n * 100) : n
}

/** Montant du forfait : « 1 200,500 DT » → 1200.5. */
function toAmount(value) {
  if (value === '' || value == null) return undefined
  if (typeof value === 'number') return value >= 0 ? value : null
  const str = String(value).replace(/\s|dt|tnd|dinars?/gi, '').replace(',', '.')
  if (!str) return undefined
  const n = Number(str)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Statut de pose : « installé » par défaut, l'import décrivant l'existant. */
function toDeaStatus(value) {
  const v = normalizeText(value)
  if (!v) return ''
  if (['installe', 'installee', 'pose', 'posee', 'actif', 'en service', 'ok', 'oui'].includes(v)) return 'installe'
  if (['a installer', 'a poser', 'planifie', 'planifiee', 'en attente'].includes(v)) return 'a_installer'
  return null   // valeur non reconnue
}

function toControlType(value) {
  const v = normalizeText(value)
  if (!v) return ''
  if (v.startsWith('semestr') || v === '6 mois') return 'semestriel'
  if (v.startsWith('annuel') || v === 'an' || v === '12 mois') return 'annuel'
  return null
}

function toElectrodeKind(value) {
  const v = normalizeText(value)
  if (!v) return ''
  if (v.startsWith('adulte') || v === 'adult') return 'adulte'
  if (v.startsWith('enfant') || v.startsWith('pedia') || v === 'child') return 'enfant'
  return null
}

/* ── Nettoyage des valeurs ───────────────────────────────────── */

function cleanStreet(v) {
  return cleanText(v)
    .replace(/^[\s.,;:-]+|[\s,;:-]+$/g, '')
    .replace(/\s\.(?=\p{L})/gu, '. ')          // « Av .Khaireddine » → « Av. Khaireddine »
}

/** Ville : capitales ramenées en casse de titre, coquilles connues corrigées. */
function cleanCity(v, governorate) {
  const s = cleanName(v)
  if (!s) return { value: '' }
  const k = keyOf(s)
  // « C.VILLE » / « CENTRE VILLE » : le centre de Tunis, dans ces fichiers.
  if (CITY_CENTER.has(k)) {
    return keyOf(governorate) === 'tunis' ? { value: 'Tunis', fixed: s } : { value: 'Centre Ville' }
  }
  if (CITY_FIXES[k]) return { value: CITY_FIXES[k], fixed: CITY_FIXES[k] === s ? null : s }
  // Ville chef-lieu : même orthographe que le gouvernorat (« GABES » → « Gabès »).
  const chefLieu = GOVERNORATES.find(g => keyOf(g) === k)
  if (chefLieu) return { value: chefLieu }
  return { value: isUpper(s) ? titleCase(s) : s }
}

/** Gouvernorat ramené à son nom officiel ; « MEDNINE » → « Médenine ». */
function canonicalGovernorate(v) {
  const s = cleanName(v)
  if (!s) return { value: '' }
  const k = keyOf(s)
  const exact = GOVERNORATES.find(g => keyOf(g) === k) || GOVERNORATE_ALIASES[k]
  if (exact) return { value: exact, fixed: GOVERNORATE_ALIASES[k] ? s : null }
  let best = null, score = 0
  for (const g of GOVERNORATES) {
    const sc = similarity(k, keyOf(g))
    if (sc > score) { score = sc; best = g }
  }
  if (best && score >= 0.75) return { value: best, fixed: s }
  return { value: isUpper(s) ? titleCase(s) : s, unknown: true }
}

/**
 * Téléphone tunisien → « 97 694 580 ». Un numéro étranger complet (indicatif
 * compris, « 32472322518 ») prend son « + » ; tout autre format est gardé tel
 * quel et signalé.
 */
function cleanPhone(v) {
  const raw = cleanText(v)
  if (!raw) return { value: '' }
  let d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('+216')) d = d.slice(4)
  else if (d.startsWith('00216')) d = d.slice(5)
  else if (d.length === 11 && d.startsWith('216')) d = d.slice(3)
  if (/^\d{8}$/.test(d)) return { value: `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}` }
  const intl = d.replace(/^(\+|00)/, '')
  if (/^[1-9]\d{9,13}$/.test(intl)) return { value: `+${intl}` }
  return { value: raw, odd: true }
}

/** Email en minuscules ; une adresse tronquée ou malformée est écartée. */
function cleanEmail(v) {
  const raw = cleanText(v)
  if (!raw) return { value: '' }
  const s = raw.toLowerCase().replace(/^mailto:/, '').replace(/(…|\.\.\.)+$/, '')
  const m = s.match(EMAIL_RE)
  if (!m || !EMAIL_TLDS.has(m[1])) return { value: '', invalid: raw }
  return { value: s }
}

/** Responsable : un nom de personne, ou à défaut une fonction (« Infirmière »). */
function cleanPerson(v) {
  const s = cleanName(v)
  if (!s) return { name: '', role: '' }
  if (ROLE_WORDS.has(keyOf(s))) return { name: '', role: isUpper(s) ? titleCase(s) : s }
  return { name: s, role: '' }
}

/**
 * Emplacement : « -1 » devient « Niveau -1 », la coquille « ACCEUIL »
 * disparaît, les étages s'écrivent d'une seule façon (« 3éme » → « 3ème »,
 * « 1ère étage » → « 1er étage »).
 */
function cleanLocation(v) {
  if (typeof v === 'number') return v < 0 ? { value: `Niveau ${v}`, fixed: String(v) } : { value: String(v) }
  const s = cleanName(v)
  if (/^-\d+$/.test(s)) return { value: `Niveau ${s}`, fixed: s }
  const out = s
    .replace(/\bacceuil\b/gi, m => (m === m.toUpperCase() ? 'ACCUEIL' : 'Accueil'))
    .replace(/\b1\s*(?:ère|ere|er)(?=\s+étage)/gi, '1er')
    .replace(/\b(\d{1,2})\s*(?:éme|eme|ème)\b/gi, '$1ème')
  return out === s ? { value: s } : { value: out, fixed: s }
}

/** Modèle de DAE → libellé du registre, ou le libellé saisi s'il est inconnu. */
function canonicalModel(raw) {
  const label = cleanName(String(raw ?? '').replace(/\+/g, ' plus '))
  if (!label) return { label: '' }
  const compact = keyOf(label).replace(/ /g, '')
  const digits  = compact.replace(/\D/g, '')

  let entry = MODELS.find(m => m.aliases.some(a => a.replace(/ /g, '') === compact) ||
                               keyOf(m.label).replace(/ /g, '') === compact)
  if (!entry) {
    // Faute de frappe : même chiffres, lettres presque identiques.
    let best = null, score = 0
    for (const m of MODELS) {
      for (const a of m.aliases) {
        const ca = a.replace(/ /g, '')
        if (ca.replace(/\D/g, '') !== digits) continue
        const sc = similarity(compact, ca)
        if (sc > score) { score = sc; best = m }
      }
    }
    if (best && score >= 0.88) entry = best
  }
  if (!entry) return { label, brand: guessBrand(label), known: false }
  return {
    label: entry.label, brand: entry.brand, mode: entry.mode, family: entry.family, known: true,
    corrected: compact !== keyOf(entry.label).replace(/ /g, '') ? cleanText(raw) : null,
  }
}

/** Type d'armoire → libellé du registre (« aivia100 » → « AIVIA 100 »). */
function canonicalArmoire(raw) {
  const label = cleanName(raw).replace(/^armoire\s+/i, '')
  if (!label) return { label: '' }
  const compact = keyOf(label).replace(/ /g, '')
  const entry = ARMOIRES.find(a => a.aliases.some(x => x.replace(/ /g, '') === compact))
  return entry
    ? { label: entry.label, corrected: keyOf(label) !== keyOf(entry.label) ? cleanText(raw) : null }
    : { label }
}

/** État des piles de l'armoire : 'ok', 'a_remplacer', '' (vide), null (illisible). */
function toPilesStatus(value) {
  const k = keyOf(value)
  if (!k) return ''
  if (k === 'a remplacer' || PILES_TO_REPLACE.has(k)) return 'a_remplacer'
  if (PILES_OK.has(k)) return 'ok'
  return null
}

/** Type de batterie → libellé propre, et cohérence avec le modèle du DAE. */
function canonicalBattery(raw, model) {
  const label = cleanName(raw)
  if (!label) return { label: '' }
  const compact = keyOf(label).replace(/ /g, '')
  const entry = BATTERIES.find(b => b.aliases.some(a => a.replace(/ /g, '') === compact) ||
                                    keyOf(b.label).replace(/ /g, '') === compact)
  if (entry) {
    const mismatch = entry.family && model?.family && entry.family !== model.family
    return { label: entry.label, mismatch: mismatch ? `${entry.label} déclarée sur un ${model.label}` : null }
  }
  // « MEDIANA », « LIFE PACK » : la batterie porte le nom de l'appareil.
  const asModel = canonicalModel(label.replace(/^batterie\s+/i, ''))
  if (asModel.known) return { label: `Batterie ${asModel.label}` }
  return { label }
}

/**
 * N° de série ramené à sa forme canonique, pour qu'un même appareil se
 * reconnaisse d'une ligne à l'autre :
 *  - espaces, préfixe GS1 « (21) » et casse retirés ;
 *  - Powerheart G5 : « D » + 11 chiffres (« D0000096674 » et « D00000096674 »
 *    désignent le même appareil) ;
 *  - ZOLL : le « X » doublé de « Xx24l872487 » est retiré.
 * Le format attendu par modèle est vérifié ; un écart est signalé, pas corrigé.
 */
function cleanSerial(raw, model = {}) {
  const typed = cleanText(raw)
  if (!typed) return { value: '' }
  let s = typed.toUpperCase().replace(/^\(21\)/, '').replace(/\s+/g, '')
  let suffix = ''

  const d = s.match(/^D(\d{1,12})([A-Z]{1,2})?$/)
  if (d && (!model.family || model.family === 'g5')) {
    const digits = d[1].replace(/^0+/, '')
    if (digits.length && digits.length <= 11) s = `D${digits.padStart(11, '0')}`
    if (d[2]) suffix = d[2]
  }
  s = s.replace(/^X(X\d{2}[A-Z])/, '$1')

  let suspect = null
  if (model.family === 'zoll-plus' && !/^X\d{2}[A-L]\d{6}$/.test(s)) {
    suspect = `N° « ${s} » inhabituel pour un ZOLL AED Plus (attendu X + 2 chiffres + 1 lettre + 6 chiffres)`
  } else if (model.family === 'zoll-3' && !/^AX\d{2}[A-L]\d{6}$/.test(s)) {
    suspect = `N° « ${s} » inhabituel pour un ZOLL AED 3 (attendu AX + 2 chiffres + 1 lettre + 6 chiffres)`
  } else if (model.family === 'g3' && !/^\d{7}$/.test(s)) {
    suspect = `N° « ${s} » inhabituel pour un Powerheart G3 (attendu 7 chiffres)`
  } else if (model.family === 'g5' && !/^D\d{11}$/.test(s)) {
    suspect = `N° « ${s} » inhabituel pour un Powerheart G5 (attendu D + 11 chiffres)`
  }

  return { value: s, typed, suffix, suspect, reformatted: s !== typed }
}

/** Clé de comparaison d'un n° déjà en base. */
const serialKey = s => String(s || '').toUpperCase().replace(/\s+/g, '')

/* ── Lecture de la feuille ───────────────────────────────────── */

/**
 * En-têtes → clés internes. Un libellé inconnu est rapproché par ressemblance
 * de ceux que l'on connaît, au-dessus de 0,84 : « Nom du site client » tombe
 * ainsi sur « nom du site » plutôt que d'être ignoré.
 */
const ALIASES = Object.keys(COL_MAP)

function mapHeader(raw) {
  const norm = normalizeHeader(raw)
  if (!norm) return { key: null, match: null, norm }
  if (COL_MAP[norm]) return { key: COL_MAP[norm], match: 'exact', norm }
  // En deçà de quatre lettres, la ressemblance ne veut plus rien dire.
  if (norm.length < 4) return { key: null, match: null, norm }

  let best = null, bestScore = 0
  for (const alias of ALIASES) {
    const score = similarity(norm, alias)
    if (score > bestScore) { bestScore = score; best = alias }
  }
  if (best && bestScore >= 0.84) {
    return { key: COL_MAP[best], match: 'approx', norm, via: best, score: bestScore }
  }
  return { key: null, match: null, norm }
}

/**
 * Lit la première feuille — les suivantes (ventes, archives) sont ignorées.
 * Les cellules sont laissées brutes (nombres pour les dates et les
 * pourcentages) : les convertir nous-mêmes évite le décalage d'un jour que
 * provoque le passage par un fuseau horaire. Chaque ligne garde son numéro
 * Excel réel (`_row`), celui qu'on cherche dans le fichier pour le corriger.
 */
function parseSheet(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet || !sheet['!ref']) return { columns: [], rows: [], sheetName: workbook.SheetNames[0] }

  const range = XLSX.utils.decode_range(sheet['!ref'])
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true })
  if (!raw.length) return { columns: [], rows: [], sheetName: workbook.SheetNames[0] }

  // Certains exports posent un titre avant le tableau : la première ligne qui
  // reconnaît au moins deux colonnes fait office d'en-tête.
  let headerIdx = raw.findIndex(r => (r || []).some(c => cleanText(c)))
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const known = (raw[i] || []).filter(c => mapHeader(c).key).length
    if (known >= 2) { headerIdx = i; break }
  }
  if (headerIdx < 0) return { columns: [], rows: [], sheetName: workbook.SheetNames[0] }

  const headers = raw[headerIdx]
  const mapped  = headers.map(h => ({ header: cleanText(h), ...mapHeader(h) }))

  // Deux colonnes pour le même champ : seule la première est lue, l'autre est
  // signalée plutôt que d'écraser silencieusement la première.
  const seen = new Set()
  const columns = mapped.map(c => {
    if (!c.key) return { ...c, ignored: !c.header ? 'vide' : 'inconnue' }
    if (seen.has(c.key)) return { ...c, key: null, ignored: 'doublon' }
    seen.add(c.key)
    return c
  })

  const rows = []
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i] || []
    const obj = {}
    columns.forEach((c, j) => {
      if (!c.key) return
      const cell = r[j]
      obj[c.key] = (cell instanceof Date || typeof cell === 'number') ? cell : String(cell ?? '').trim()
    })
    if (!Object.values(obj).some(v => v !== '' && v != null)) continue
    obj._row = range.s.r + 1 + i
    rows.push(obj)
  }

  return { columns: columns.filter(c => c.header), rows, sheetName: workbook.SheetNames[0] }
}

/* ── Normalisation d'une ligne ───────────────────────────────── */

const DATE_LABELS = {
  deaInstallDate: "Date d'installation", deaNextControl: 'Prochain contrôle', deaLastControl: 'Dernier contrôle',
  battActivation: 'Installation de la batterie', battExpiry: 'DLC de la batterie',
  elecExpiry: 'DLC des électrodes', elecAdultExpiry: 'DLC des électrodes adulte',
  elecCprExpiry: 'DLC des électrodes RCP', elecUniversalExpiry: 'DLC des électrodes universelles',
  elecChildExpiry: 'DLC des électrodes pédiatriques',
}

/**
 * Ligne ramenée à des valeurs propres : chaînes nettoyées, dates 'aaaa-mm-jj',
 * modèle et n° de série canoniques. La fonction est idempotente — `execute`
 * la rejoue sur les lignes déjà normalisées renvoyées par l'écran — et ne
 * lève d'erreur que pour ce qui empêche vraiment d'importer la ligne.
 *
 * Chaque remarque porte l'identifiant du groupe d'analyse où elle se range.
 */
function normalizeRow(input, order = 'dmy') {
  const row = { _row: input._row }
  const errors = [], warnings = [], fixes = []
  const warn = (id, text) => warnings.push({ id, text })
  const fix  = (id, text) => fixes.push({ id, text })

  /* ── Client ── */
  row.name  = cleanName(input.name)
  row.notes = cleanText(input.notes)
  if (!row.name) errors.push({ id: 'blocking', text: 'Nom du client absent — la ligne ne peut être rattachée' })

  for (const [key, label] of [['underContract', 'Contrat'], ['sitePack', 'Pack']]) {
    const b = toBool(input[key])
    row[key] = b === true ? 'oui' : b === false ? 'non' : ''
    if (b === null) warn('invalidValue', `${label} non compris : « ${cleanText(input[key])} » (attendu oui/non) — ignoré`)
  }
  const price = toAmount(input.contractPrice)
  row.contractPrice = price == null ? '' : String(price)
  if (price === null) warn('invalidValue', `Forfait illisible : « ${cleanText(input.contractPrice)} » — ignoré`)

  /* ── Adresses : colonnes propres au site, à défaut les colonnes nues ── */
  const address = (prefix, street, city, gov) => {
    row[`${prefix}Street`] = cleanStreet(street)
    const g = canonicalGovernorate(gov)
    row[`${prefix}Governorate`] = g.value
    if (g.fixed) fix('textFixed', `Gouvernorat « ${g.fixed} » → ${g.value}`)
    if (g.unknown) warn('invalidValue', `Gouvernorat inconnu : « ${g.value} »`)
    const c = cleanCity(city, g.value)
    row[`${prefix}City`] = c.value
    if (c.fixed) fix('textFixed', `Ville « ${c.fixed} » → ${c.value}`)
  }
  address('site', input.siteStreet || input.street, input.siteCity || input.city,
    input.siteGovernorate || input.governorate)
  address('client', input.clientStreet, input.clientCity, input.clientGovernorate)

  /* ── Site ── */
  row.siteName  = cleanName(input.siteName)
  row.siteNotes = cleanText(input.siteNotes)
  row.siteClosed = !!input.siteClosed

  const person = cleanPerson(input.siteContactName)
  row.siteContactName = person.name
  row.siteContactRole = cleanText(input.siteContactRole) || person.role
  const phone = cleanPhone(input.siteContactPhone)
  row.siteContactPhone = phone.value
  if (phone.odd) warn('invalidValue', `Téléphone au format inhabituel : « ${phone.value} » — gardé tel quel`)
  const email = cleanEmail(input.siteContactEmail)
  row.siteContactEmail = email.value
  if (email.invalid) warn('invalidValue', `Email invalide ou tronqué : « ${email.invalid} » — ignoré`)

  /* ── DAE ── */
  const model = canonicalModel(input.deaType)
  row.deaType = model.label
  if (model.corrected) fix('modelFixed', `Modèle « ${model.corrected} » lu comme « ${model.label} »`)

  const serial = cleanSerial(input.deaSerial, model)
  row.deaSerial = serial.value
  if (serial.reformatted) fix('serialFixed', `N° de série « ${serial.typed} » → ${serial.value}`)
  if (serial.suspect) warn('serialSuspect', serial.suspect)

  const loc = cleanLocation(input.deaLocation)
  row.deaLocation = loc.value
  if (loc.fixed) fix('textFixed', `Emplacement « ${loc.fixed} » → ${loc.value}`)

  const notes = [cleanText(input.deaNotes)].filter(Boolean)
  if (serial.suffix) {
    const line = `N° de série relevé dans le fichier : ${serial.typed}`
    if (!notes.some(n => n.includes(line))) notes.push(line)
    warn('serialSuspect', `Suffixe « ${serial.suffix} » retiré du n° « ${serial.typed} » — gardé en note du DAE`)
  }
  row.deaNotes = notes.join('\n')
  row.deaBroken = !!input.deaBroken

  /* ── Armoire ── */
  const armoire = canonicalArmoire(input.armoireModel)
  row.armoireModel = armoire.label
  if (armoire.corrected) fix('textFixed', `Armoire « ${armoire.corrected} » → ${armoire.label}`)
  const piles = toPilesStatus(input.armoirePiles)
  row.armoirePiles = piles || ''
  if (piles === null) {
    warn('invalidValue', `Piles de l'armoire : « ${cleanText(input.armoirePiles)} » non compris (attendu « épuisé » ou « ok ») — ignoré`)
  }

  const status = toDeaStatus(input.deaStatus)
  row.deaStatus = status || ''
  if (status === null) warn('invalidValue', `Statut du DAE inconnu : « ${cleanText(input.deaStatus)} » — ignoré`)
  const ctype = toControlType(input.deaControlType)
  row.deaControlType = ctype || ''
  if (ctype === null) warn('invalidValue', `Type de contrôle inconnu : « ${cleanText(input.deaControlType)} » — ignoré`)

  /* ── Dates ── */
  for (const key of DATE_FIELDS) {
    const d = parseDateCell(input[key], order)
    const label = DATE_LABELS[key]
    const typed = cleanText(input[key])
    row[key] = d.iso || ''
    if (d.flag === 'closed') {
      row.siteClosed = true
      warn('siteClosed', `« ${typed} » dans la colonne ${label} — site marqué fermé`)
    } else if (d.flag === 'broken') {
      row.deaBroken = true
      warn('broken', `« ${typed} » dans la colonne ${label} — DAE signalé en panne`)
    } else if (d.invalid) {
      warn('invalidValue', `${label} illisible : « ${typed} » — ignorée`)
    } else if (d.approx) {
      warn('approxDate', `${label} : année seule (${d.approx}) — lue comme le 01/01/${d.approx}, à préciser`)
    } else if (d.fixed) {
      fix('dateFixed', `${label} « ${typed} » lue comme le ${frDate(d.iso)}`)
    }
  }

  /* ── Batterie ── */
  const batt = canonicalBattery(input.battProductName, model)
  row.battProductName = batt.label
  if (batt.mismatch) warn('modelMismatch', batt.mismatch)
  row.battSerial = cleanText(input.battSerial).toUpperCase()
  row.battLot    = cleanText(input.battLot)

  row.battLevel = ''
  const rawLevel = input.battLevel
  if (rawLevel !== '' && rawLevel != null) {
    const typed = cleanText(rawLevel)
    if (typeof rawLevel === 'string' && /\b(panne|hors service|hs)\b/.test(keyOf(rawLevel))) {
      row.deaBroken = true
      warn('broken', `« ${typed} » dans la colonne Charge batterie — DAE signalé en panne`)
    } else {
      const pct = toPercent(rawLevel)
      if (pct === null) warn('invalidValue', `Charge de la batterie illisible : « ${typed} » — ignorée`)
      else if (pct !== undefined && (pct < 0 || pct > 100)) warn('invalidValue', `Charge de la batterie hors bornes : ${typed} — ignorée`)
      else if (pct !== undefined) row.battLevel = String(Math.round(pct))
    }
  }

  /* ── Électrodes ── */
  const kind = toElectrodeKind(input.elecKind)
  row.elecKind = kind || ''
  if (kind === null) warn('invalidValue', `Type d'électrodes inconnu : « ${cleanText(input.elecKind)} » — ignoré`)
  row.elecProductName = cleanText(input.elecProductName)
  row.elecLot         = cleanText(input.elecLot)

  return { row, errors, warnings, fixes }
}

const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
/* Une date du fichier n'a pas d'heure : on la pose à minuit UTC. Minuit local
   la ferait basculer la veille dès que le serveur tourne à l'ouest de
   Greenwich — un contrôle du 1er tomberait au 31. */
const asDate = iso => (iso ? new Date(`${iso}T00:00:00.000Z`) : null)

/** Cohérence des dates d'une ligne déjà normalisée. */
function checkRow(row) {
  const out = []
  const warn = (id, text) => out.push({ id, text })
  const now = today()
  const in15y = addMonths(now, 15 * 12)

  const install = asDate(row.deaInstallDate)
  const last    = asDate(row.deaLastControl)
  const next    = asDate(row.deaNextControl)
  const act     = asDate(row.battActivation)
  const battDlc = asDate(row.battExpiry)

  for (const key of DATE_FIELDS) {
    const d = asDate(row[key])
    if (d && d.getUTCFullYear() < 2000) warn('dateOrder', `${DATE_LABELS[key]} au ${frDate(row[key])} : date très ancienne, faute de frappe probable`)
    if (d && d > in15y) warn('dateOrder', `${DATE_LABELS[key]} au ${frDate(row[key])} : date très lointaine, faute de frappe probable`)
  }
  // Comparées en 'aaaa-mm-jj' : une date du jour n'est pas « dans le futur »
  // parce que minuit UTC tombe après minuit local.
  const todayIso = isoToday()
  if (row.deaInstallDate > todayIso) warn('dateOrder', "Date d'installation dans le futur")
  if (row.deaLastControl > todayIso) warn('dateOrder', 'Dernier contrôle daté dans le futur')
  if (row.battActivation > todayIso) warn('dateOrder', 'Installation de la batterie datée dans le futur')
  if (last && install && last < install) warn('dateOrder', "Dernier contrôle antérieur à l'installation")
  if (next && last && next < last)       warn('dateOrder', 'Prochain contrôle antérieur au dernier contrôle')
  if (act && battDlc && battDlc < act)   warn('dateOrder', 'DLC de la batterie antérieure à son installation')

  if (battDlc && battDlc < now) warn('expired', `Batterie périmée depuis le ${frDate(row.battExpiry)}`)
  for (const key of ['elecExpiry', 'elecAdultExpiry', 'elecCprExpiry', 'elecUniversalExpiry', 'elecChildExpiry']) {
    const d = asDate(row[key])
    if (d && d < now) warn('expired', `${DATE_LABELS[key]} dépassée (${frDate(row[key])})`)
  }
  if (row.battLevel !== '' && Number(row.battLevel) <= 25) {
    warn('expired', `Batterie à ${row.battLevel} % — remplacement à prévoir`)
  }
  return out
}

const hasDeviceData   = row => DEVICE_KEYS.some(k => row[k] !== undefined && row[k] !== '') || row.deaBroken
const identifiesDevice = row => !!(row.deaType || row.deaSerial)

/* ── Rapport d'analyse ───────────────────────────────────────── */

/* Groupes du rapport, dans l'ordre d'affichage : d'abord ce qui demande un
   regard, ensuite ce que l'import a fait de lui-même. `hint` dit quoi faire. */
const ANALYSIS_GROUPS = {
  blocking:       { level: 'error', title: 'Lignes non importables',
    hint: 'Ces lignes sont écartées : complétez-les dans le fichier.' },
  serialConflict: { level: 'warn', title: 'Même n° de série sur deux sites sous contrat',
    hint: 'Un appareil ne peut être qu’à un endroit : le second garde son DAE, sans n° de série, avec une note. Vérifiez sur place.' },
  multiSite:      { level: 'warn', title: 'Appareil cité chez plusieurs clients ou sites',
    hint: 'Souvent une vente de consommables passée par un revendeur. L’appareil est rattaché au site indiqué ; déplacez-le si ce n’est pas le bon.' },
  nearSerial:     { level: 'warn', title: 'N° de série presque identiques sur un même site',
    hint: 'Probablement le même appareil saisi deux fois avec une faute de frappe.' },
  serialSuspect:  { level: 'warn', title: 'N° de série au format inhabituel',
    hint: 'Chiffre manquant ou en trop ? Le n° est importé tel quel.' },
  dataConflict:   { level: 'warn', title: 'Informations contradictoires pour un même DAE',
    hint: 'Les lignes qui citent l’appareil ne disent pas la même chose : la première (ou la plus récente pour les consommables) est retenue.' },
  sharedContact:  { level: 'warn', title: 'Même contact pour des clients différents',
    hint: 'Copier-coller probable d’une ligne à l’autre, ou clients à regrouper.' },
  siteAddress:    { level: 'warn', title: 'Adresses différentes pour un même site',
    hint: 'L’adresse la plus fréquente est retenue.' },
  modelMismatch:  { level: 'warn', title: 'Batterie incompatible avec le modèle du DAE' },
  invalidValue:   { level: 'warn', title: 'Valeurs illisibles ignorées',
    hint: 'La ligne est importée, sans la valeur en cause.' },
  approxDate:     { level: 'warn', title: 'Dates incomplètes (année seule)' },
  dateOrder:      { level: 'warn', title: 'Dates incohérentes ou suspectes' },
  orphanConso:    { level: 'warn', title: 'Consommables sans appareil identifiable',
    hint: 'Ni modèle ni n° de série, et plusieurs DAE (ou aucun) sur le site : les DLC sont gardées en note du site.' },
  siteClosed:     { level: 'warn', title: 'Sites signalés fermés',
    hint: 'Ni contrat ni visite planifiée pour ces sites.' },
  broken:         { level: 'warn', title: 'Appareils signalés en panne' },
  armoirePiles:   { level: 'warn', title: 'Armoires dont les piles sont à remplacer',
    hint: 'Elles alimentent l’alerte « piles d’armoire » du tableau de bord.' },
  missing:        { level: 'warn', title: 'Informations manquantes' },
  expired:        { level: 'warn', title: 'Consommables périmés, batteries faibles' },
  modelFixed:     { level: 'info', title: 'Modèles de DAE corrigés' },
  serialFixed:    { level: 'info', title: 'N° de série remis en forme' },
  dateFixed:      { level: 'info', title: 'Dates réparées' },
  duplicateLines: { level: 'info', title: 'Lignes en double fusionnées',
    hint: 'Même n° de série sur le même site : un seul DAE, ses consommables les plus récents.' },
  siteSplit:      { level: 'info', title: 'Sites homonymes séparés par adresse' },
  siteMerged:     { level: 'info', title: 'Variantes de nom de site regroupées' },
  orphanAttached: { level: 'info', title: 'Consommables rattachés à l’unique DAE du site' },
  mentionDropped: { level: 'info', title: 'Lignes rattachées à l’appareil d’un autre site' },
  contractMixed:  { level: 'info', title: 'Contrat « OUI » et « NON » sur un même site — OUI retenu' },
  textFixed:      { level: 'info', title: 'Libellés harmonisés' },
}

function createReport() {
  const groups = new Map()   // id → Map(texte → Set(lignes))
  return {
    add(id, text, rows = []) {
      if (!groups.has(id)) groups.set(id, new Map())
      const g = groups.get(id)
      if (!g.has(text)) g.set(text, new Set())
      for (const r of [].concat(rows)) {
        const n = typeof r === 'number' ? r : r?._row
        if (n) g.get(text).add(n)
      }
    },
    toJSON() {
      return Object.entries(ANALYSIS_GROUPS)
        .filter(([id]) => groups.has(id))
        .map(([id, meta]) => {
          const items = [...groups.get(id)].map(([text, rows]) => ({
            text, rows: [...rows].sort((a, b) => a - b),
          }))
          const rows = new Set(items.flatMap(i => i.rows))
          return { id, ...meta, count: items.length, rowCount: rows.size, items }
        })
    },
  }
}

const rowList = rows => {
  const nums = uniq(rows.map(r => (typeof r === 'number' ? r : r._row))).sort((a, b) => a - b)
  return nums.length > 8 ? `lignes ${nums.slice(0, 8).join(', ')}… (${nums.length})` : `ligne${nums.length > 1 ? 's' : ''} ${nums.join(', ')}`
}

/* ── Consolidation : clients → sites → DAE ───────────────────── */

/**
 * Regroupe les lignes d'un client en sites.
 *
 * Deux lignes portent le même site si elles en portent le nom… et sont au
 * même endroit : « STATION DE POMPAGE » à Korba et à Sbeitla sont deux sites.
 * On rapproche donc, sous un même nom, les lignes qui partagent la ville ou
 * la rue. Ensuite, deux noms dont l'un contient l'autre (« ECOLE » et « ECOLE
 * DE CARTHAGE ») à la même adresse sont le même site.
 */
function buildSites(client, ctx) {
  const byName = new Map()
  for (const row of client.rows) {
    const k = keyOf(row.siteName || DEFAULT_SITE_NAME)
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push(row)
  }

  let groups = []
  for (const list of byName.values()) {
    const clusters = clusterByLocation(list)
    const base = mostFrequent(list.map(r => r.siteName)) || DEFAULT_SITE_NAME
    clusters.forEach(rows => groups.push({ rows, base, split: clusters.length > 1 }))
    if (clusters.length > 1) {
      const where = clusters.map(rows => locationLabel(rows)).join(', ')
      ctx.report.add('siteSplit',
        `${client.name} — « ${base} » à ${clusters.length} adresses (${where}) : ${clusters.length} sites distincts`, list)
    }
  }

  /* Variantes de nom : le nom le plus long sert de cible. */
  groups.sort((a, b) => keyOf(b.base).length - keyOf(a.base).length)
  const kept = []
  for (const g of groups) {
    const target = kept.find(t => containsWords(keyOf(t.base), keyOf(g.base)) && shareLocation(t.rows, g.rows))
    if (target) {
      target.rows.push(...g.rows)
      target.variants.push(g.base)
      ctx.report.add('siteMerged', `${client.name} — « ${g.base} » regroupé avec « ${target.base} » (même adresse)`, g.rows)
    } else {
      kept.push({ ...g, variants: [] })
    }
  }

  /* Noms définitifs : une part de site homonyme prend le nom de sa ville. */
  const sites = kept.map(g => ({
    rows: g.rows.sort(byRow),
    name: g.split ? `${g.base} — ${locationLabel(g.rows)}` : g.base,
    deas: [], orphans: [],
  }))
  const taken = new Map()
  for (const s of sites) {
    const k = keyOf(s.name)
    const n = taken.get(k) || 0
    taken.set(k, n + 1)
    if (n) s.name = `${s.name} (${n + 1})`
  }
  return sites.sort((a, b) => byRow(a.rows[0], b.rows[0]))
}

function locationLabel(rows) {
  return mostFrequent(rows.map(r => r.siteCity)) ||
         mostFrequent(rows.map(r => r.siteGovernorate)) ||
         mostFrequent(rows.map(r => r.siteStreet)) || 'adresse inconnue'
}

/** Paquets de lignes au même endroit : même ville ou même rue. */
function clusterByLocation(list) {
  const parent = list.map((_, i) => i)
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const keys = list.map(r => ({ city: keyOf(r.siteCity), street: keyOf(r.siteStreet) }))
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = keys[i], b = keys[j]
      if ((a.city && a.city === b.city) || (a.street && a.street === b.street)) parent[find(j)] = find(i)
    }
  }
  const located = new Map()
  const floating = []
  list.forEach((row, i) => {
    if (!keys[i].city && !keys[i].street) { floating.push(row); return }
    const root = find(i)
    if (!located.has(root)) located.set(root, [])
    located.get(root).push(row)
  })
  const clusters = [...located.values()]
  if (!clusters.length) return [floating]
  // Une ligne sans adresse rejoint le paquet le plus fourni.
  clusters.sort((a, b) => b.length - a.length)[0].push(...floating)
  return clusters
}

function shareLocation(a, b) {
  const streets = rows => new Set(rows.map(r => keyOf(r.siteStreet)).filter(Boolean))
  const cities  = rows => new Set(rows.map(r => keyOf(r.siteCity)).filter(Boolean))
  const sa = streets(a), sb = streets(b)
  if ([...sa].some(s => sb.has(s))) return true
  const ca = cities(a), cb = cities(b)
  return [...ca].some(c => cb.has(c)) && (!sa.size || !sb.size)
}

/** Nouveau DAE du plan. */
function newDea(site, serial, owner) {
  const dea = { serial, owner, rows: [owner], foreign: new Set(), notes: [], site }
  site.deas.push(dea)
  return dea
}

/** Meilleure ligne pour une valeur : la plus récente (DLC la plus lointaine). */
function latestBy(rows, key) {
  let best = null
  for (const r of rows) if (r[key] && (!best || r[key] > best[key])) best = r
  return best
}

/**
 * Fusionne toutes les lignes d'un appareil. Les informations de pose viennent
 * de la ligne de référence ; les consommables, de la ligne la plus récente —
 * une DLC plus lointaine signale un remplacement.
 */
function finalizeDea(dea, ctx) {
  const rows  = dea.rows.slice().sort(byRow)
  const own   = rows.filter(r => !dea.foreign.has(r))
  const owner = dea.owner
  const first = key => owner[key] || own.find(r => r[key])?.[key] || rows.find(r => r[key])?.[key] || ''
  const label = dea.serial || `${owner.deaType || 'DAE'} (${rowList([owner])})`

  const models = uniq(rows.map(r => r.deaType).filter(Boolean))
  dea.model = first('deaType')
  if (models.length > 1) {
    ctx.report.add('dataConflict', `${label} : modèles ${models.join(' / ')} — « ${dea.model} » retenu`, rows)
  }
  const locations = uniq(own.map(r => r.deaLocation).filter(Boolean))
  dea.location = owner.deaLocation || locations[0] || ''
  if (locations.length > 1) {
    ctx.report.add('dataConflict', `${label} : emplacements ${locations.join(' / ')} — « ${dea.location} » retenu`, own)
  }
  const installs = uniq(rows.map(r => r.deaInstallDate).filter(Boolean))
  dea.installDate = owner.deaInstallDate || minStr(installs)
  if (installs.length > 1) {
    ctx.report.add('dataConflict',
      `${label} : dates d'installation ${installs.map(frDate).join(' / ')} — ${frDate(dea.installDate)} retenue`, rows)
  }

  dea.status      = first('deaStatus')
  dea.controlType = first('deaControlType')
  dea.nextControl = minStr(own.map(r => r.deaNextControl))
  dea.lastControl = maxStr(own.map(r => r.deaLastControl))
  dea.broken      = own.some(r => r.deaBroken)
  dea.notes       = uniq([...dea.notes, ...rows.flatMap(r => (r.deaNotes ? r.deaNotes.split('\n') : []))])
  if (dea.broken && !dea.notes.includes(BROKEN_NOTE)) dea.notes.push(BROKEN_NOTE)

  /* Batterie : la ligne à la DLC la plus lointaine, à défaut la plus récemment installée. */
  const battRows = rows.filter(r => r.battProductName || r.battActivation || r.battExpiry ||
                                    r.battLevel !== '' || r.battSerial || r.battLot)
  if (battRows.length) {
    const best = latestBy(battRows, 'battExpiry') || latestBy(battRows, 'battActivation') ||
                 battRows.find(r => r === owner) || battRows[0]
    const level = best.battLevel !== '' ? best.battLevel
      : (owner.battLevel !== '' ? owner.battLevel : (battRows.find(r => r.battLevel !== '')?.battLevel || ''))
    dea.battery = {
      // Sans type écrit, la batterie est celle que le modèle impose.
      productName: best.battProductName || battRows.find(r => r.battProductName)?.battProductName ||
        BATTERIES.find(b => b.family && b.family === canonicalModel(dea.model).family)?.label ||
        (dea.model ? `Batterie ${dea.model}` : ''),
      serial:      best.battSerial || '',
      lot:         best.battLot || '',
      activation:  best.battActivation || '',
      expiry:      best.battExpiry || '',
      level,
    }
  }

  /* Électrodes : un jeu adulte (avec ou sans capteur RCP), un jeu universel,
     un jeu pédiatrique — chacun à sa DLC la plus lointaine. */
  const adult = [], univ = [], child = []
  for (const r of rows) {
    if (r.elecAdultExpiry)     adult.push({ expiry: r.elecAdultExpiry, rcp: false })
    if (r.elecCprExpiry)       adult.push({ expiry: r.elecCprExpiry, rcp: true })
    if (r.elecUniversalExpiry) univ.push({ expiry: r.elecUniversalExpiry })
    if (r.elecChildExpiry)     child.push({ expiry: r.elecChildExpiry })
    if (r.elecExpiry || r.elecLot || r.elecProductName) {
      (r.elecKind === 'enfant' ? child : adult)
        .push({ expiry: r.elecExpiry, lot: r.elecLot, name: r.elecProductName })
    }
  }
  const best = list => list.reduce((b, e) => (!b || (e.expiry || '') > (b.expiry || '') ? e : b), null)
  dea.electrodes = []
  const a = best(adult), u = best(univ), c = best(child)
  if (a) dea.electrodes.push({ kind: 'adulte', expiry: a.expiry, lot: a.lot || '',
    productName: a.name || electrodeName(a.rcp ? 'rcp' : 'adulte', dea.model) })
  if (u) dea.electrodes.push({ kind: '', expiry: u.expiry, lot: '',
    productName: electrodeName('universelle', dea.model) })
  if (c) dea.electrodes.push({ kind: 'enfant', expiry: c.expiry, lot: c.lot || '',
    productName: c.name || electrodeName('enfant', dea.model) })

  /* Armoire : son modèle, et l'état des piles de l'alarme constaté — daté du
     dernier contrôle quand le fichier en donne un. */
  const armoires = uniq(own.map(r => r.armoireModel).filter(Boolean))
  const armoireModel = owner.armoireModel || armoires[0] || ''
  if (armoires.length > 1) {
    ctx.report.add('dataConflict', `${label} : armoires ${armoires.join(' / ')} — « ${armoireModel} » retenue`, own)
  }
  const piles = owner.armoirePiles || own.find(r => r.armoirePiles)?.armoirePiles || ''
  dea.armoire = armoireModel || piles
    ? { model: armoireModel, pilesStatus: piles, pilesCheckedAt: piles ? dea.lastControl : '' }
    : null

  dea.firstRow = rows[0]._row
  return dea
}

/** Responsable du site : nom, fonction, téléphone, email. */
function buildPerson(name, phone, email, role) {
  if (!name && !phone && !email && !role) return null
  return { name: name || '', role: role || '', phone: phone || '', email: email || '' }
}

/** Deux personnes se valent si nom, téléphone et email coïncident. */
function samePerson(a, b) {
  return normalizeText(a.name)  === normalizeText(b.name) &&
         normalizeText(a.phone) === normalizeText(b.phone) &&
         normalizeText(a.email) === normalizeText(b.email)
}

/**
 * Fusionne les responsables. Une fiche déjà connue par son nom se complète
 * (téléphone ou email ajoutés) au lieu d'être dupliquée : le même responsable
 * apparaît souvent avec le téléphone sur une ligne et sans sur la suivante.
 */
function mergePeople(existing = [], incoming = []) {
  const out = existing.map(p => (p.toObject ? p.toObject() : { ...p }))
  for (const p of incoming) {
    if (out.some(e => samePerson(e, p))) continue
    const byName = p.name && out.find(e => normalizeText(e.name) === normalizeText(p.name))
    if (byName) {
      if (p.phone && !byName.phone) byName.phone = p.phone
      if (p.email && !byName.email) byName.email = p.email
      if (p.role && !byName.role)   byName.role  = p.role
      continue
    }
    // Même téléphone ou même email sans nom : c'est la même ligne, moins complète.
    const bySame = !p.name && out.find(e => (p.phone && e.phone === p.phone) || (p.email && e.email === p.email))
    if (bySame) {
      if (p.phone && !bySame.phone) bySame.phone = p.phone
      if (p.email && !bySame.email) bySame.email = p.email
      continue
    }
    out.push(p)
  }
  return out
}

/** Consommables d'une ligne orpheline, en clair pour la note du site. */
function describeConsumables(row) {
  const parts = []
  if (row.battProductName || row.battExpiry || row.battLevel !== '') {
    parts.push([row.battProductName || 'batterie',
      row.battExpiry && `DLC ${frDate(row.battExpiry)}`,
      row.battLevel !== '' && `${row.battLevel} %`].filter(Boolean).join(' '))
  }
  const elec = [['elecAdultExpiry', 'électrodes adulte'], ['elecCprExpiry', 'électrodes adulte RCP'],
    ['elecUniversalExpiry', 'électrodes universelles'], ['elecChildExpiry', 'électrodes pédiatriques'],
    ['elecExpiry', 'électrodes']]
  for (const [k, l] of elec) if (row[k]) parts.push(`${l} DLC ${frDate(row[k])}`)
  if (row.armoireModel || row.armoirePiles) {
    parts.push(['armoire', row.armoireModel, row.armoirePiles && `piles ${PILES_LABELS[row.armoirePiles]}`]
      .filter(Boolean).join(' '))
  }
  return parts.join(', ')
}

/**
 * Agrège les lignes d'un site : adresse la plus fréquente, responsables,
 * contrat, pack, dernière visite, notes.
 */
function finalizeSite(site, client, ctx) {
  const rows = site.rows
  const pick = key => mostFrequent(rows.map(r => r[key]))
  site.address = { street: pick('siteStreet'), city: pick('siteCity'), governorate: pick('siteGovernorate') }

  const streets = new Map()
  for (const r of rows) {
    const k = keyOf(r.siteStreet)
    if (!k) continue
    if (!streets.has(k)) streets.set(k, { label: r.siteStreet, n: 0 })
    streets.get(k).n++
  }
  if (streets.size > 1) {
    const detail = [...streets.values()].map(s => `« ${s.label} » (${s.n})`).join(', ')
    ctx.report.add('siteAddress', `${client.name} / ${site.name} : ${detail} — « ${site.address.street} » retenue`, rows)
  }

  site.contacts = mergePeople([], rows
    .map(r => buildPerson(r.siteContactName, r.siteContactPhone, r.siteContactEmail, r.siteContactRole))
    .filter(Boolean))

  site.underContract = rows.some(r => r.underContract === 'oui')
  if (site.underContract && rows.some(r => r.underContract === 'non')) {
    ctx.report.add('contractMixed', `${client.name} / ${site.name}`, rows)
  }
  site.hasPack  = rows.some(r => r.sitePack === 'oui')
  site.price    = rows.find(r => r.contractPrice)?.contractPrice || ''
  site.closed   = rows.some(r => r.siteClosed)
  if (site.closed) ctx.report.add('siteClosed', `${client.name} / ${site.name}`, rows.filter(r => r.siteClosed))

  site.lastControl = maxStr(rows.map(r => r.deaLastControl))
  site.nextControl = minStr(rows.map(r => r.deaNextControl).filter(d => d >= isoToday()))
  site.controlType = rows.find(r => r.deaControlType)?.deaControlType || ''
  site.installDate = minStr(site.deas.map(d => d.installDate))

  site.notes = uniq(rows.map(r => r.siteNotes).filter(Boolean))
  if (site.closed) site.notes.push(CLOSED_NOTE)
  /* Une note par jeu de consommables. Pas de n° de ligne : il change dès que
     le fichier est retouché, et un second import dupliquerait la note. */
  const orphans = new Map()
  for (const r of site.orphans) {
    const text = describeConsumables(r)
    orphans.set(text, (orphans.get(text) || 0) + 1)
  }
  for (const [text, n] of orphans) {
    site.notes.push(`Consommables relevés sans appareil identifié : ${text}${n > 1 ? ` (×${n})` : ''}.`)
  }
}

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Le cœur de l'import : des lignes normalisées au plan client → site → DAE.
 *
 * `clientMerges` porte les regroupements de clients décidés à l'écran
 * (« TLS TUNIS » et « TLS SFAX » rangés sous « TLS CONTACT »). Le plan rendu
 * est ce que `execute` écrit, et ce que `validate` compte et analyse.
 */
function consolidate(rows, { clientMerges = [], report = createReport() } = {}) {
  const rowNotes = new Map()   // n° de ligne → { warnings, fixes }
  const note = (row, kind, text) => {
    const n = row._row
    if (!rowNotes.has(n)) rowNotes.set(n, { warnings: [], fixes: [] })
    rowNotes.get(n)[kind].push(text)
  }
  const ctx = { report, note }

  const rename = new Map()
  for (const m of Array.isArray(clientMerges) ? clientMerges : []) {
    const into = cleanName(m?.into)
    if (!into || !Array.isArray(m.names)) continue
    for (const n of m.names) rename.set(keyOf(n), into)
  }

  /* ── Clients ── */
  const clientMap = new Map()
  for (const row of rows.slice().sort(byRow)) {
    const forced = rename.get(keyOf(row.name)) || null
    const key = keyOf(forced || row.name)
    if (!clientMap.has(key)) clientMap.set(key, { key, forced, rows: [] })
    clientMap.get(key).rows.push(row)
  }
  const clients = [...clientMap.values()].map(c => {
    const client = { key: c.key, name: c.forced || mostFrequent(c.rows.map(r => r.name)), rows: c.rows }
    client.sites = buildSites(client, ctx)
    client.sites.forEach(s => { s.client = client })
    return client
  })

  const siteOf = new Map()
  for (const c of clients) for (const s of c.sites) for (const r of s.rows) siteOf.set(r, s)
  const where = r => `${siteOf.get(r).client.name} / ${siteOf.get(r).name}`

  /* ── Appareils identifiés par leur n° de série ──
     La première ligne qui cite un n° fixe le site de l'appareil — sauf si une
     ligne sous contrat le place ailleurs : le parc suivi fait foi. */
  const bySerial = new Map()
  for (const r of rows.slice().sort(byRow)) {
    if (!r.deaSerial) continue
    if (!bySerial.has(r.deaSerial)) bySerial.set(r.deaSerial, [])
    bySerial.get(r.deaSerial).push(r)
  }
  const conflictRows = []
  const mentions = new Map()   // ligne → site de l'appareil qu'elle cite
  for (const [serial, list] of bySerial) {
    const owner = list.find(r => r.underContract === 'oui') || list[0]
    const home  = siteOf.get(owner)
    const dea   = newDea(home, serial, owner)
    const same = [], elsewhere = []
    for (const r of list) {
      if (r === owner) continue
      const site = siteOf.get(r)
      if (site === home) { dea.rows.push(r); same.push(r); continue }
      if (r.underContract === 'oui' && owner.underContract === 'oui') {
        conflictRows.push({ row: r, serial, owner })
        report.add('serialConflict',
          `${serial} : déclaré chez ${where(owner)} (${rowList([owner])}) et chez ${where(r)} (${rowList([r])})`, [owner, r])
        note(r, 'warnings', `N° ${serial} déjà déclaré chez ${where(owner)} — DAE importé sans n° de série`)
        continue
      }
      dea.rows.push(r)
      dea.foreign.add(r)
      elsewhere.push(r)
      mentions.set(r, home)
      note(r, 'warnings', `Appareil ${serial} rattaché à ${where(owner)} (${rowList([owner])})`)
    }
    if (same.length) {
      report.add('duplicateLines', `${serial} — ${where(owner)} : ${rowList([owner, ...same])} fusionnées`, [owner, ...same])
      same.forEach(r => note(r, 'fixes', `Même DAE que la ${rowList([owner])} — lignes fusionnées`))
    }
    if (elsewhere.length) {
      const all = [owner, ...elsewhere].map(r => `${where(r)} (${rowList([r])})`).join(' ; ')
      report.add('multiSite', `${serial} : ${all} → rattaché à ${where(owner)}`, [owner, ...elsewhere])
    }
  }

  /* ── Appareils sans n° de série : une ligne = un appareil ── */
  for (const r of rows) {
    if (r.deaSerial || !identifiesDevice(r)) continue
    newDea(siteOf.get(r), '', r)
  }
  for (const { row, serial, owner } of conflictRows) {
    const dea = newDea(siteOf.get(row), '', row)
    dea.notes.push(`N° de série déclaré : ${serial}, déjà attribué chez ${where(owner)} — à vérifier sur place.`)
  }

  /* ── Consommables sans appareil identifié ── */
  for (const r of rows) {
    if (identifiesDevice(r) || !hasDeviceData(r)) continue
    const site = siteOf.get(r)
    if (site.deas.length === 1) {
      const dea = site.deas[0]
      dea.rows.push(r)
      report.add('orphanAttached', `${where(r)} : ${describeConsumables(r) || 'informations'} → ${dea.serial || dea.owner.deaType}`, r)
      note(r, 'fixes', `Rattachée à l'unique DAE du site (${dea.serial || dea.owner.deaType})`)
    } else {
      site.orphans.push(r)
      report.add('orphanConso', `${where(r)} : ${describeConsumables(r) || 'informations sans appareil'} (${site.deas.length} DAE sur le site)`, r)
      note(r, 'warnings', 'Consommables sans appareil identifiable — gardés en note du site')
    }
  }

  /* ── Sites qui ne tenaient qu'à la mention d'un appareil posé ailleurs ── */
  const dropped = new Map()    // ligne d'un site non créé → site qui la reprend
  for (const c of clients) {
    const isMention = s => !s.deas.length && !s.orphans.length && s.rows.every(r => mentions.has(r))
    if (!c.sites.some(s => !isMention(s))) continue
    c.sites = c.sites.filter(s => {
      if (!isMention(s)) return true
      report.add('mentionDropped', `${c.name} / ${s.name} : ses lignes ne citent que des appareils rattachés ailleurs — site non créé`, s.rows)
      s.rows.forEach(r => dropped.set(r, mentions.get(r)))
      return false
    })
  }

  /* ── Finitions ── */
  for (const c of clients) {
    for (const s of c.sites) {
      s.deas.forEach(d => finalizeDea(d, ctx))
      s.deas.sort((a, b) => a.firstRow - b.firstRow)
      finalizeSite(s, c, ctx)
    }
  }

  analyzePlan(clients, report)
  // Site où se retrouve chaque ligne, une fois les sites non créés écartés.
  const placeOf = row => dropped.get(row) || siteOf.get(row)
  return { clients, report, rowNotes, placeOf }
}

/** Contrôles transverses sur le plan : contacts partagés, doublons, manques. */
function analyzePlan(clients, report) {
  /* Même contact pour des clients différents. */
  const owners = new Map()
  for (const c of clients) {
    for (const s of c.sites) {
      for (const p of s.contacts) {
        for (const k of [p.phone && `tél. ${p.phone}`, p.email && p.email]) {
          if (!k) continue
          if (!owners.has(k)) owners.set(k, new Map())
          owners.get(k).set(c.name, s.rows)
        }
      }
    }
  }
  for (const [k, byClient] of owners) {
    if (byClient.size < 2) continue
    report.add('sharedContact', `${k} : ${[...byClient.keys()].join(', ')}`, [...byClient.values()].flat())
  }

  const missing = (text, rows) => rows.length && report.add('missing', text, rows)
  const allSites = clients.flatMap(c => c.sites.map(s => ({ c, s })))
  const allDeas  = allSites.flatMap(({ c, s }) => s.deas.map(d => ({ c, s, d })))

  for (const { c, s } of allSites) {
    /* Deux n° presque identiques, l'un placé (emplacement ou pose), l'autre
       non : même appareil saisi deux fois, avec une faute de frappe. */
    const serials = s.deas.filter(d => d.serial)
    for (let i = 0; i < serials.length; i++) {
      for (let j = i + 1; j < serials.length; j++) {
        const a = serials[i], b = serials[j]
        const placed = d => !!(d.location || d.installDate)
        if (a.model !== b.model || placed(a) === placed(b)) continue
        if (levenshtein(a.serial, b.serial) <= 2) {
          report.add('nearSerial', `${c.name} / ${s.name} : ${a.serial} et ${b.serial}`, [...a.rows, ...b.rows])
        }
      }
    }
    if (s.underContract && !s.closed && s.deas.length && !s.lastControl && !s.installDate && !s.nextControl) {
      report.add('missing', `${c.name} / ${s.name} : sous contrat, sans dernier contrôle ni date de pose — aucune visite planifiée`, s.rows)
    }
    if (s.underContract && !s.deas.length) {
      report.add('missing', `${c.name} / ${s.name} : sous contrat mais sans DAE — pas de contrat créé`, s.rows)
    }
  }

  missing('Sites sans responsable ni téléphone', allSites
    .filter(({ s }) => !s.contacts.some(p => p.phone)).flatMap(({ s }) => s.rows.slice(0, 1)))
  missing('Sites sans email de contact', allSites
    .filter(({ s }) => !s.contacts.some(p => p.email)).flatMap(({ s }) => s.rows.slice(0, 1)))
  missing('DAE sans n° de série', allDeas.filter(({ d }) => !d.serial).map(({ d }) => d.owner))
  missing('DAE sans modèle', allDeas.filter(({ d }) => !d.model).map(({ d }) => d.owner))
  missing("DAE sans date d'installation", allDeas.filter(({ d }) => !d.installDate).map(({ d }) => d.owner))
  missing('DAE sans emplacement', allDeas.filter(({ d }) => !d.location).map(({ d }) => d.owner))
  missing("DAE sans type d'armoire", allDeas.filter(({ d }) => !d.armoire?.model).map(({ d }) => d.owner))

  for (const { c, s, d } of allDeas) {
    if (d.broken) report.add('broken', `${c.name} / ${s.name} : ${d.model} ${d.serial}`.trim(), d.rows)
    if (d.armoire?.pilesStatus === 'a_remplacer') {
      report.add('armoirePiles',
        `${c.name} / ${s.name} : ${[d.model, d.serial].filter(Boolean).join(' ')}${d.armoire.model ? ` — armoire ${d.armoire.model}` : ''}`,
        d.rows.filter(r => r.armoirePiles === 'a_remplacer'))
    }
  }
}

/**
 * Clients qui sont probablement le même : un nom commun (« TLS CONTACT »,
 * « TLS TUNIS ») appuyé par un contact, un domaine email ou un gouvernorat
 * partagé. Un contact commun suffit à proposer le regroupement ; il est coché
 * d'office quand le nom le confirme.
 */
function suggestClientMerges(clients) {
  const info = clients.map(c => {
    const contacts = c.sites.flatMap(s => s.contacts)
    return {
      c,
      key: keyOf(c.name),
      tokens: new Set(keyOf(c.name).split(' ').filter(w => w.length >= 2 && !GENERIC_WORDS.has(w))),
      phones: new Set(contacts.map(p => p.phone).filter(Boolean)),
      emails: new Set(contacts.map(p => p.email).filter(Boolean)),
      domains: new Set(contacts.map(p => p.email?.split('@')[1]).filter(d => d && !PUBLIC_MAIL_DOMAINS.has(d))),
      govs: new Set(c.sites.map(s => s.address.governorate).filter(Boolean)),
    }
  })
  const inter = (a, b) => [...a].filter(x => b.has(x))

  const links = []
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const a = info[i], b = info[j]
      const tokens   = inter(a.tokens, b.tokens)
      // Un nom contenu dans l'autre ne compte que s'il a un mot distinctif :
      // « PALM BEACH » dans « PALM BEACH CLUB » ne dit rien.
      const inside   = (big, small) => containsWords(big.key, small.key) && small.tokens.size > 0
      const contain  = inside(a, b) || inside(b, a)
      const contact  = [...inter(a.phones, b.phones), ...inter(a.emails, b.emails)]
      const domains  = inter(a.domains, b.domains)
      const govs     = inter(a.govs, b.govs)
      const named    = tokens.length > 0 || contain
      if (!contact.length && !(named && domains.length) && !(contain && govs.length)) continue
      const reasons = []
      if (contact.length) reasons.push(`même contact (${contact[0]})`)
      if (domains.length) reasons.push(`même domaine email (${domains[0]})`)
      if (named)          reasons.push(contain ? 'un nom contient l’autre' : `nom commun (${tokens.join(', ').toUpperCase()})`)
      if (!contact.length && govs.length) reasons.push(`même gouvernorat (${govs[0]})`)
      links.push({ i, j, reasons, strong: contact.length > 0 && named })
    }
  }

  /* Regroupement transitif des liens. */
  const parent = info.map((_, i) => i)
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  links.forEach(l => { parent[find(l.j)] = find(l.i) })
  const groups = new Map()
  info.forEach((_, i) => {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(i)
  })

  return [...groups.values()].filter(g => g.length > 1).map(g => {
    const members = g.map(i => info[i].c)
    const glinks  = links.filter(l => g.includes(l.i))
    const into    = members.slice().sort((a, b) => b.rows.length - a.rows.length || byRow(a.rows[0], b.rows[0]))[0]
    return {
      key: members.map(m => m.key).sort().join('+'),
      names: members.map(m => m.name),
      into: into.name,
      reasons: uniq(glinks.flatMap(l => l.reasons)),
      checked: glinks.every(l => l.strong),
      rows: members.reduce((n, m) => n + m.rows.length, 0),
    }
  })
}

/* ── Modèles de DAE ──────────────────────────────────────────── */

function guessBrand(label) {
  const n = normalizeText(label)
  return BRANDS.find(b => n.includes(normalizeText(b))) || ''
}

/**
 * Rapproche les modèles du plan du catalogue.
 *
 * Un libellé qui ne correspond à aucun produit n'est pas une erreur : l'écran
 * d'import propose les modèles les plus ressemblants, et l'on tranche — le
 * rattacher à un modèle existant ou en créer un. C'est cette décision que
 * `execute` rejoue.
 */
async function resolveModels(clients) {
  const labels = new Map()
  for (const c of clients) for (const s of c.sites) for (const d of s.deas) {
    if (!d.model) continue
    const key = keyOf(d.model)
    if (!labels.has(key)) labels.set(key, { label: d.model, key, rows: [], count: 0 })
    const entry = labels.get(key)
    entry.count++
    if (entry.rows.length < 12) entry.rows.push(d.firstRow)
  }
  if (!labels.size) return { models: [], catalog: [] }

  const products = await Product.find({ isActive: { $ne: false } })
    .select('name brand reference category')
    .lean()

  const models = [...labels.values()].map(entry => {
    const exact = products.find(p => keyOf(p.name) === entry.key)
      || products.find(p => p.reference && keyOf(p.reference) === entry.key)
    const known = canonicalModel(entry.label)

    const suggestions = exact ? [] : products
      .map(p => ({
        _id: String(p._id), name: p.name, brand: p.brand || '', category: p.category,
        score: Math.min(1, similarity(entry.label, p.name) + (p.category === DEA_CATEGORY ? 0.08 : 0)),
      }))
      .filter(p => p.score >= 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    return {
      label: entry.label,
      key: entry.key,
      count: entry.count,
      rows: entry.rows.sort((a, b) => a - b),
      matched: exact ? { _id: String(exact._id), name: exact.name, brand: exact.brand || '', category: exact.category } : null,
      suggestions,
      suggestedAction: exact ? 'link' : 'create',
      suggestedBrand: known.brand || guessBrand(entry.label),
      suggestedMode: known.mode || '',
    }
  }).sort((a, b) => b.count - a.count)

  const catalog = products
    .filter(p => p.category === DEA_CATEGORY)
    .map(p => ({ _id: String(p._id), name: p.name, brand: p.brand || '', category: p.category }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  return { models, catalog }
}

/* ── Validation (simulation) ─────────────────────────────────── */

function parseMerges(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try { return JSON.parse(value) } catch { return [] }
  }
  return []
}

async function validate(req, res) {
  // Le fichier arrive dans le corps multipart de la requête ; un appelant qui
  // l'a déjà en main (script de reprise) le pose directement sur `req.file`.
  if (!req.file) {
    await new Promise((resolve, reject) =>
      upload(req, res, err => (err ? reject(err) : resolve()))
    )
  }

  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu.' })

  let workbook
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false })
  } catch {
    return res.status(400).json({ message: 'Fichier Excel invalide ou corrompu.' })
  }

  /* Trois façons pour un fichier d'être inexploitable, trois messages : on dit
     ce qui manque, pas seulement que ça ne marche pas. */
  const { columns, rows, sheetName } = parseSheet(workbook)
  const read = columns.filter(c => c.key)

  if (!read.length) {
    const seen = columns.map(c => c.header).filter(Boolean).slice(0, 12)
    return res.status(400).json({
      message: seen.length
        ? `Aucune colonne reconnue. En-têtes lus : ${seen.join(', ')}. Téléchargez le modèle pour retrouver les intitulés attendus.`
        : 'Aucun en-tête trouvé : la première ligne du fichier doit porter les noms de colonnes.',
    })
  }
  if (!columns.some(c => c.key === 'name')) {
    return res.status(400).json({
      message: 'Colonne « Client » introuvable : ajoutez une colonne « Client » (ou « Nom du client ») — c’est la seule vraiment obligatoire.',
    })
  }
  if (rows.length === 0) {
    return res.status(400).json({
      message: 'Les colonnes sont reconnues mais le fichier ne contient aucune ligne de données.',
    })
  }

  // La convention de date est déduite du fichier entier, pas ligne par ligne :
  // une seule date sans ambiguïté suffit à trancher pour toutes les autres.
  const forced   = String(req.body?.dateFormat || '').toLowerCase()
  const detected = detectDateOrder(rows)
  const order    = ['dmy', 'mdy'].includes(forced) ? forced : detected.order

  const report = createReport()
  // Sites fermés et DAE en panne sont récapitulés au niveau du site ou de
  // l'appareil : la remarque de ligne reste dans l'aperçu, pas dans le rapport.
  const rowOnly = new Set(['siteClosed', 'broken'])
  const lines = rows.map(raw => {
    const n = normalizeRow(raw, order)
    const warnings = [...n.warnings, ...checkRow(n.row)]
    for (const w of warnings) if (!rowOnly.has(w.id)) report.add(w.id, w.text, n.row._row)
    for (const f of n.fixes)  report.add(f.id, f.text, n.row._row)
    for (const e of n.errors) report.add(e.id, e.text, n.row._row)
    return { ...n, warnings }
  })

  const validRows = lines.filter(l => !l.errors.length).map(l => l.row)
  const plan = consolidate(validRows, { clientMerges: parseMerges(req.body?.clientMerges), report })

  /* Ce que la base sait déjà : clients et sites existants seront mis à jour,
     pas dupliqués. */
  const names = plan.clients.map(c => c.name)
  const known = names.length
    ? await Client.find({ $or: names.map(n => ({ name: exactRe(n) })) }).select('name').lean()
    : []
  const knownClients = new Map(known.map(c => [keyOf(c.name), c]))
  const knownSites = new Set()
  if (known.length) {
    const sites = await Site.find({ client: { $in: known.map(c => c._id) } }).select('name client').lean()
    const byId  = new Map(known.map(c => [String(c._id), c.name]))
    sites.forEach(s => knownSites.add(`${keyOf(byId.get(String(s.client)))}|${keyOf(s.name)}`))
  }

  const results = lines.map(l => {
    const site  = plan.placeOf(l.row)
    const extra = plan.rowNotes.get(l.row._row) || { warnings: [], fixes: [] }
    const cKey  = site ? keyOf(site.client.name) : ''
    return {
      row: l.row,
      rowNum: l.row._row,
      errors: l.errors.map(e => e.text),
      warnings: [...l.warnings.map(w => w.text), ...extra.warnings],
      fixes: [...l.fixes.map(f => f.text), ...extra.fixes],
      valid: l.errors.length === 0,
      clientName: site?.client.name || l.row.name,
      siteName: site?.name || l.row.siteName || DEFAULT_SITE_NAME,
      hasDea: hasDeviceData(l.row),
      clientExists: knownClients.has(cKey),
      siteExists: site ? knownSites.has(`${cKey}|${keyOf(site.name)}`) : false,
    }
  })

  const { models, catalog } = await resolveModels(plan.clients)
  const sites = plan.clients.flatMap(c => c.sites)
  const deas  = sites.flatMap(s => s.deas)

  // Pièces rattachées aux DAE : celles que le catalogue n'a pas encore seront créées.
  const parts = collectParts(plan.clients)
  const knownParts = parts.length
    ? await Product.find({ $or: parts.map(p => ({ name: exactRe(p.name) })) }).select('name').lean()
    : []
  const knownPartKeys = new Set(knownParts.map(p => keyOf(p.name)))
  parts.forEach(p => { p.exists = knownPartKeys.has(p.key) })

  res.json({
    sheetName,
    columns: columns.map(c => ({
      header: c.header,
      key: c.key,
      label: c.key ? FIELD_LABELS[c.key] : null,
      match: c.match || null,
      via: c.via || null,
      ignored: c.ignored || null,
    })),
    dateFormat: { order, certain: detected.certain, forced: ['dmy', 'mdy'].includes(forced) },
    models,
    catalog,
    parts,
    results,
    analysis: report.toJSON(),
    clientGroups: suggestClientMerges(plan.clients),
    summary: {
      total:     rows.length,
      valid:     validRows.length,
      invalid:   rows.length - validRows.length,
      clients:   plan.clients.length,
      sites:     sites.length,
      deas:      deas.length,
      deasWithSerial: deas.filter(d => d.serial).length,
      contracts: sites.filter(s => s.underContract && !s.closed && s.deas.length).length,
      warnings:  results.filter(r => r.warnings.length > 0).length,
      fixed:     results.filter(r => r.fixes.length > 0).length,
      newClients:  plan.clients.filter(c => !knownClients.has(keyOf(c.name))).length,
      newSites:    plan.clients.reduce((n, c) =>
        n + c.sites.filter(s => !knownSites.has(`${keyOf(c.name)}|${keyOf(s.name)}`)).length, 0),
      knownModels: models.filter(m => m.matched).length,
      newModels:   models.filter(m => !m.matched).length,
      ignoredColumns: columns.filter(c => c.ignored === 'inconnue').length,
    },
  })
}

/* ── Modèles : décisions rejouées ────────────────────────────── */

/**
 * Construit la table « libellé → modèle du catalogue » à partir des décisions
 * prises à l'écran. Un libellé sans décision est cherché au catalogue ; s'il
 * n'y est pas, le DAE gardera son libellé sans produit rattaché — le parc
 * reste juste, seul le lien au stock manque.
 */
async function buildModelMap(decisions, labels, userId) {
  const map     = new Map()
  const created = []
  const wanted  = new Map(labels.map(l => [keyOf(l), l]))

  // La catégorie des défibrillateurs doit exister : sinon le produit serait
  // invisible du stock. Une base remise à zéro la recrée ici.
  await seedIfEmpty()

  for (const d of (Array.isArray(decisions) ? decisions : [])) {
    const key = keyOf(d.key || d.label)
    if (!key || !wanted.has(key)) continue

    if (d.action === 'skip') { map.set(key, null); continue }

    if (d.action === 'link' && d.productId) {
      const product = await Product.findById(d.productId).select('_id name').lean()
      if (product) { map.set(key, product._id); continue }
    }

    if (d.action === 'create') {
      const name = cleanName(d.name || d.label)
      if (!name) continue
      // Un modèle du même nom créé entre-temps est repris tel quel.
      let product = await Product.findOne({ name: exactRe(name) }).select('_id name')
      if (!product) {
        const known    = canonicalModel(name)
        const category = d.category || DEA_CATEGORY
        const exists   = await ProductCategory.findOne({ slug: category }).select('_id').lean()
        const mode     = d.deviceMode || known.mode
        product = await Product.create({
          name,
          brand:     cleanText(d.brand) || known.brand || guessBrand(name),
          reference: cleanText(d.reference),
          category:  exists ? category : DEA_CATEGORY,
          ...(['automatique', 'semi-automatique'].includes(mode) ? { deviceMode: mode } : {}),
          requiresSerialNumber: true,
          stock: 0,
          listedOnWebsite: false,
          notes: 'Modèle créé par l’import du parc',
          createdBy: userId,
        })
        created.push({ _id: String(product._id), name: product.name })
      }
      map.set(key, product._id)
    }
  }

  // Libellés sans décision : rapprochement au catalogue par le nom exact.
  for (const [key, label] of wanted) {
    if (map.has(key)) continue
    const product = await Product.findOne({ name: exactRe(label), isActive: { $ne: false } }).select('_id').lean()
    map.set(key, product?._id || null)
  }

  return { map, created }
}

/* ── Pièces : batteries, électrodes, armoires ────────────────── */

/**
 * Pièces citées par le plan, une entrée par modèle : c'est la liste des
 * produits que l'import rattache aux DAE — et crée au catalogue s'il ne les
 * connaît pas encore.
 */
function collectParts(clients) {
  const parts = new Map()
  const add = (category, name, brand) => {
    if (!name) return
    const key = keyOf(name)
    if (!parts.has(key)) parts.set(key, { key, category, name, brand: brand || '', count: 0 })
    parts.get(key).count++
  }
  for (const c of clients) for (const s of c.sites) for (const d of s.deas) {
    const family = partsFamily(d.model)
    if (d.battery?.productName) {
      // Des piles CR123A du commerce ne sont pas une pièce de la marque de l'appareil.
      add(PART_CATEGORIES.batteries, d.battery.productName, /^piles?\b/i.test(d.battery.productName) ? '' : family.brand)
    }
    for (const e of d.electrodes || []) add(PART_CATEGORIES.electrodes, e.productName, family.brand)
    if (d.armoire?.model) {
      add(PART_CATEGORIES.armoires, armoireProductName(d.armoire.model),
        /^aivia\b/i.test(d.armoire.model) ? 'AIVIA' : '')
    }
  }
  return [...parts.values()].sort((a, b) => a.category.localeCompare(b.category) || b.count - a.count)
}

/**
 * Produits du catalogue pour ces pièces : repris s'ils existent sous le même
 * nom, créés sinon dans leur catégorie. Rend la table « nom → produit ».
 *
 * Chaque pièce posée reçoit ensuite son article « installé » (voir
 * `attachMountedParts`) : sans n° de lot dans le fichier, elle est suivie par
 * son modèle sur son DAE, et passe hors service le jour où on la remplace.
 */
async function buildPartsMap(parts, userId) {
  const map     = new Map()
  const created = []
  if (!parts.length) return { map, created }

  await seedIfEmpty()
  const categories = new Set((await ProductCategory.find().select('slug').lean()).map(c => c.slug))

  for (const part of parts) {
    let product = await Product.findOne({ name: exactRe(part.name) }).select('_id name').lean()
    if (!product) {
      const lotTracked = part.category === PART_CATEGORIES.batteries || part.category === PART_CATEGORIES.electrodes
      product = await Product.create({
        name:      part.name,
        brand:     part.brand,
        category:  categories.has(part.category) ? part.category : 'autres',
        requiresLotNumber: lotTracked,
        stock: 0,
        listedOnWebsite: false,
        notes: 'Modèle créé par l’import du parc',
        createdBy: userId,
      })
      created.push({ _id: String(product._id), name: product.name, category: part.category })
    }
    map.set(part.key, product._id)
  }
  return { map, created }
}

/* ── Écriture d'un DAE ───────────────────────────────────────── */

function mergeNotes(existing, lines) {
  const current = String(existing || '').split('\n').map(s => s.trim()).filter(Boolean)
  for (const l of lines) if (l && !current.includes(l)) current.push(l)
  return current.join('\n')
}

/**
 * Applique un DAE du plan au site : création s'il n'existe pas, mise à jour
 * sinon. Un appareil se retrouve par son n° de série ; sans n°, c'est le
 * n-ième appareil du même modèle au même emplacement — ce qui garde un
 * second import du même fichier sans doublon. Rien de vide n'efface l'existant.
 */
function upsertDea(site, pd, productId, used, partsMap = new Map()) {
  const partOf = name => (name ? partsMap.get(keyOf(name)) || null : null)
  let dea
  if (pd.serial) {
    dea = site.deas.find(d => serialKey(d.serialNumber) === serialKey(pd.serial))
  } else {
    const key = `${keyOf(pd.model)}|${keyOf(pd.location)}`
    const n = used.get(key) || 0
    used.set(key, n + 1)
    dea = site.deas.filter(d => !d.serialNumber && `${keyOf(d.deviceType)}|${keyOf(d.location)}` === key)[n]
  }

  const created = !dea
  if (created) {
    site.deas.push({ status: 'installe' })
    dea = site.deas[site.deas.length - 1]
  }

  if (pd.model)       dea.deviceType   = pd.model
  if (pd.serial)      dea.serialNumber = pd.serial
  if (pd.location)    dea.location     = pd.location
  if (productId)      dea.product      = productId
  if (pd.status)      dea.status       = pd.status
  if (pd.controlType) dea.controlType  = pd.controlType
  if (pd.installDate) dea.installationDate = asDate(pd.installDate)
  if (pd.nextControl) dea.nextControlDate  = asDate(pd.nextControl)
  if (pd.notes.length) dea.notes = mergeNotes(dea.notes, pd.notes)

  if (pd.battery) {
    const b0 = pd.battery
    let batt = (b0.serial && dea.batteries.find(b => serialKey(b.serialNumber) === serialKey(b0.serial)))
      || (b0.lot && dea.batteries.find(b => normalizeText(b.lotNumber) === normalizeText(b0.lot)))
      || dea.batteries[0]
    if (!batt) {
      dea.batteries.push({})
      batt = dea.batteries[dea.batteries.length - 1]
    }
    if (b0.productName) batt.productName    = b0.productName
    if (partOf(b0.productName)) batt.product = partOf(b0.productName)
    if (b0.serial)      batt.serialNumber   = b0.serial
    if (b0.lot)         batt.lotNumber      = b0.lot
    if (b0.activation)  batt.activationDate = asDate(b0.activation)
    if (b0.expiry)      batt.expiryDate     = asDate(b0.expiry)
    if (b0.level !== '' && b0.level != null) batt.level = Number(b0.level)
  }

  for (const e of pd.electrodes) {
    let elec = dea.electrodes.find(x => (x.kind || '') === e.kind &&
      (e.kind !== '' || normalizeText(x.productName) === normalizeText(e.productName)))
    if (!elec) {
      dea.electrodes.push({ kind: e.kind })
      elec = dea.electrodes[dea.electrodes.length - 1]
    }
    elec.kind = e.kind
    if (e.productName) elec.productName = e.productName
    if (partOf(e.productName)) elec.product = partOf(e.productName)
    if (e.lot)         elec.lotNumber   = e.lot
    if (e.expiry)      elec.expiryDate  = asDate(e.expiry)
  }

  if (pd.armoire) {
    if (!dea.armoire) dea.armoire = {}
    if (pd.armoire.model) dea.armoire.model = pd.armoire.model
    const armoireProduct = partOf(armoireProductName(pd.armoire.model))
    if (armoireProduct) dea.armoire.product = armoireProduct
    if (pd.armoire.pilesStatus) {
      dea.armoire.pilesStatus = pd.armoire.pilesStatus
      if (pd.armoire.pilesCheckedAt) dea.armoire.pilesCheckedAt = asDate(pd.armoire.pilesCheckedAt)
    }
  }

  return { dea, created }
}

/* ── Stock : l'appareil posé devient un exemplaire ───────────── */

/**
 * Rattache le DAE au stock. Si un exemplaire porte déjà ce numéro de série, il
 * est simplement mis au bon statut ; sinon il est créé, marqué installé chez
 * le client. Sans cet exemplaire, un appareil du parc n'existe nulle part dans
 * l'inventaire — et la fiche produit annonce un parc vide.
 */
async function attachStockItem(site, dea, userId) {
  if (!dea.product || !dea.serialNumber) return null

  const existing = await ProductItem.findOne({
    product: dea.product,
    serialNumber: dea.serialNumber,
  })
  if (existing) {
    await syncDeaWithItem(site, dea)
    return null
  }

  const product = await Product.findById(dea.product).select('category reference').lean()
  const item = await ProductItem.create({
    product:      dea.product,
    category:     product?.category || DEA_CATEGORY,
    reference:    product?.reference || '',
    serialNumber: dea.serialNumber,
    quantity:     1,
    status:       dea.status === 'installe' ? 'installe' : 'reserve',
    entryDate:    dea.installationDate || new Date(),
    client:       site.client,
    site:         site._id,
    dea:          dea._id,
    notes:        'Exemplaire repris par l’import du parc',
    history: [{
      action: 'Repris par l’import du parc',
      to: dea.status === 'installe' ? 'installe' : 'reserve',
      note: site.name, user: userId, date: new Date(),
    }],
    createdBy: userId,
  })
  return item
}

/* ── Contrats ────────────────────────────────────────────────── */

/** Numéros CT-aaaa-nnnn, à la suite de ceux déjà attribués cette année. */
async function contractNumberer() {
  const year = new Date().getFullYear()
  let n = await Contract.countDocuments({
    createdAt: { $gte: new Date(`${year}-01-01`), $lt: new Date(`${year + 1}-01-01`) },
  })
  return async () => {
    let number
    do { number = `CT-${year}-${String(++n).padStart(4, '0')}` } while (await Contract.exists({ contractNumber: number }))
    return number
  }
}

/**
 * Contrat de maintenance du site marqué « sous contrat ».
 *
 * Le fichier ne donne ni dates ni (souvent) de forfait : le contrat est créé
 * sans dates plutôt qu'avec des dates inventées. Sans échéance, le calendrier
 * théorique du contrat reste muet — les visites sont celles planifiées depuis
 * le dernier contrôle réel — jusqu'à ce que les dates soient saisies.
 */
async function ensureContract(site, client, price, nextNumber, userId) {
  const existing = await Contract.findOne({ site: site._id, isActive: true, status: 'actif' })
  if (existing) {
    if (price != null && existing.price == null) { existing.price = price; await existing.save() }
    return { contract: existing, created: false }
  }
  const contract = await Contract.create({
    contractNumber: await nextNumber(),
    site:       site._id,
    siteName:   site.name,
    client:     client._id,
    clientName: client.name,
    type:       'maintenance',
    status:     'actif',
    price:      price ?? undefined,
    notes:      'Contrat repris par l’import du parc : dates et forfait à compléter.',
    createdBy:  userId,
  })
  return { contract, created: true }
}

/* ── Planification des visites ───────────────────────────────── */

/** Nombre de mois entiers entre deux dates. */
function monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

/**
 * Prochaines visites d'un site, calées sur le dernier contrôle.
 *
 * Le rythme reste celui du contrat de maintenance — une visite tous les six
 * mois, une sur deux valant contrôle annuel — mais l'ancre n'est plus la pose :
 * c'est la dernière visite réellement faite, seule date fiable sur un parc
 * repris des années après son installation. La parité (semestriel / annuel)
 * continue, elle, de se compter depuis la pose quand on la connaît, pour que
 * le contrôle annuel tombe bien à l'anniversaire.
 *
 * Aucune visite n'est planifiée dans le passé : les visites manquées sont de
 * l'histoire, pas du planning.
 */
function planDates({ lastControl, installDate, nextControl, controlType }, horizonMonths) {
  const now      = today()
  const anchor   = lastControl || installDate
  const horizon  = addMonths(now, horizonMonths)
  const out      = []

  /* Une date de prochain contrôle donnée par le fichier fait foi : le terrain
     sait mieux que la règle. */
  if (nextControl) {
    const d = new Date(nextControl)
    d.setHours(9, 0, 0, 0)
    if (d >= now) out.push({ date: d, type: controlType || typeAt(installDate || anchor, d) })
  }

  if (!anchor) return out

  for (let i = 1; i <= 40; i++) {
    const raw = addMonths(anchor, i * PERIOD_MONTHS)
    if (raw > horizon) break
    const date = skipWeekend(raw)
    date.setHours(9, 0, 0, 0)
    if (date < now) continue
    if (out.some(o => Math.abs(o.date - date) < 20 * 86400000)) continue
    out.push({ date, type: controlType || typeAt(installDate || anchor, raw) })
  }
  return out
}

/** Semestriel ou annuel : une visite sur deux depuis la pose est annuelle. */
function typeAt(anchor, date) {
  if (!anchor) return 'semestriel'
  const n = Math.round(monthsBetween(new Date(anchor), new Date(date)) / PERIOD_MONTHS)
  return n % 2 === 0 ? 'annuel' : 'semestriel'
}

const dayKey = d => new Date(d).toISOString().slice(0, 10)

/**
 * Écrit dans le planning ce que le fichier raconte du site : la dernière visite
 * comme visite faite, les suivantes comme visites à venir — ces dernières pour
 * les seuls sites sous contrat, les autres n'ayant pas de maintenance à suivre.
 *
 * Une visite couvre le site entier : on ne crée qu'une intervention par
 * échéance. Les visites portent `manualDate` : elles viennent d'un relevé de
 * terrain, pas du calendrier théorique d'un contrat, et ne doivent pas être
 * balayées par lui.
 */
async function planSiteControls(site, ps, clientName, contractId, opts, userId) {
  const out = { planned: 0, history: 0 }
  const lastControl = asDate(ps.lastControl)
  const installDate = asDate(ps.installDate)
  const nextControl = asDate(ps.nextControl)
  if (!lastControl && !installDate && !nextControl) return out

  const existing = await Intervention.find({ site: site._id }).select('scheduledDate').lean()
  const takenDays = new Set(existing.map(i => (i.scheduledDate ? dayKey(i.scheduledDate) : null)).filter(Boolean))

  const base = {
    client: site.client, clientName,
    site: site._id, siteName: site.name,
    ...(contractId ? { contract: contractId } : {}),
    manualDate: true, createdBy: userId,
  }
  const docs = []

  /* La dernière visite connue entre au planning comme visite faite : c'est
     elle qui justifie la date de la suivante. */
  if (opts.recordLastControl && lastControl) {
    const d = new Date(lastControl)
    d.setHours(9, 0, 0, 0)
    if (!takenDays.has(dayKey(d))) {
      docs.push({
        ...base,
        controlType: ps.underContract ? (ps.controlType || typeAt(installDate, d)) : 'hors_contrat',
        status: 'termine',
        scheduledDate: d,
        completedDate: d,
        notes: 'Visite reprise de l’import du parc (dernier contrôle déclaré).',
        history: [{ action: 'import', user: userId, date: new Date(), details: 'Dernier contrôle repris du fichier importé' }],
      })
      takenDays.add(dayKey(d))
      out.history++
    }
  }

  if (opts.planControls && ps.underContract && !ps.closed) {
    const dates = planDates({ lastControl, installDate, nextControl, controlType: ps.controlType }, opts.horizonMonths)
    for (const p of dates) {
      if (takenDays.has(dayKey(p.date))) continue
      takenDays.add(dayKey(p.date))
      docs.push({
        ...base,
        controlType: p.type,
        status: 'planifie',
        scheduledDate: p.date,
        history: [{
          action: 'creation', user: userId, date: new Date(),
          details: lastControl
            ? `Contrôle ${p.type} planifié à l’import, six mois après le dernier contrôle`
            : `Contrôle ${p.type} planifié à l’import, six mois après la pose`,
        }],
      })
      out.planned++
    }
  }

  if (docs.length) await Intervention.insertMany(docs)
  // La fiche des DAE reprend la première visite à venir du site.
  await syncSiteNextControl(site._id)
  return out
}

/* ── Import réel ─────────────────────────────────────────────── */

async function execute(req, res) {
  const { rows, models: decisions, clientMerges, options } = req.body
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'Aucune ligne à importer.' })
  }

  const opts = {
    planControls:      options?.planControls      !== false,
    recordLastControl: options?.recordLastControl !== false,
    createStockItems:  options?.createStockItems  !== false,
    createContracts:   options?.createContracts   !== false,
    horizonMonths:     Number(options?.horizonMonths) > 0
      ? Math.min(Number(options.horizonMonths), 36)
      : DEFAULT_HORIZON_MONTHS,
  }

  // Les dates arrivent déjà en 'aaaa-mm-jj' : la convention du fichier a été
  // tranchée à la validation, l'import ne la rejoue pas.
  const normalized = rows
    .map((r, i) => normalizeRow({ ...r, _row: r._row || i + 1 }, 'dmy'))
    .filter(n => !n.errors.length)
    .map(n => n.row)
  if (!normalized.length) {
    return res.status(400).json({ message: 'Aucune ligne exploitable : le nom du client est absent partout.' })
  }

  const plan = consolidate(normalized, { clientMerges })

  /* ── Repartir de zéro ──
     Le parc du fichier remplace tout : la base est vidée juste avant l'import,
     dans la même requête — jamais avant que le fichier ait été lu et validé.
     Même garde-fou que le bouton « Réinitialiser » des paramètres. */
  let decided = Array.isArray(decisions) ? decisions : []
  let resetReport = null
  if (options?.resetFirst) {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Repartir de zéro est réservé au Super Admin.' })
    }
    if (String(options.confirm || '').trim().toUpperCase() !== 'REINITIALISER') {
      return res.status(422).json({ message: 'Confirmation manquante : tapez REINITIALISER.' })
    }
    const keepCatalog = options.keepCatalog === true
    resetReport = await resetBusinessData({ keepFiles: false, wipeTodos: options.wipeTodos === true, keepCatalog })
    console.warn(`[IMPORT] Base vidée avant import par ${req.user.username} (${req.user._id})`,
      JSON.stringify(resetReport))
    // Le catalogue vient d'être vidé : un modèle rattaché à un produit existant
    // n'a plus de produit où se rattacher, il est recréé sous son libellé.
    if (!keepCatalog) {
      decided = decided.map(d => (d.action === 'link' ? { ...d, action: 'create', name: d.name || d.label } : d))
    }
  }

  let modelMap, modelsCreated
  try {
    const labels  = uniq(plan.clients.flatMap(c => c.sites.flatMap(s => s.deas.map(d => d.model))).filter(Boolean))
    const built   = await buildModelMap(decided, labels, req.user._id)
    modelMap      = built.map
    modelsCreated = built.created
  } catch (err) {
    return res.status(400).json({ message: `Modèles de DAE : ${err.message}` })
  }

  // Batteries, électrodes et armoires : au catalogue, et rattachées à leur DAE.
  let partsMap, partsCreated
  try {
    const built  = await buildPartsMap(collectParts(plan.clients), req.user._id)
    partsMap     = built.map
    partsCreated = built.created
  } catch (err) {
    return res.status(400).json({ message: `Batteries, électrodes et armoires : ${err.message}` })
  }

  const nextNumber = await contractNumberer()
  const results = []

  for (const pc of plan.clients) {
    try {
      /* ── Client ── mise à jour non destructive : les champs absents du
         fichier sont conservés. L'adresse est celle du premier site. */
      const set = { name: pc.name }
      const own = pc.rows.find(r => r.clientStreet || r.clientCity)
      const addr = own
        ? { street: own.clientStreet, city: own.clientCity, governorate: own.clientGovernorate }
        : (pc.sites[0]?.address || {})
      if (addr.street)      set['address.street']      = addr.street
      if (addr.city)        set['address.city']        = addr.city
      if (addr.governorate) set['address.governorate'] = addr.governorate
      const clientNotes = uniq(pc.rows.map(r => r.notes).filter(Boolean))

      let client = await Client.findOne({ name: exactRe(pc.name) })
      const clientCreated = !client
      if (!client) {
        client = new Client({ createdBy: req.user._id })
      }
      client.set(set)
      if (clientNotes.length) client.notes = mergeNotes(client.notes, clientNotes)
      await client.save()

      /* ── Sites et DAE ── */
      let sitesCreated = 0, deasCreated = 0, deasUpdated = 0, contractsCreated = 0
      let itemsCreated = 0, partItemsCreated = 0, controlsPlanned = 0, controlsHistory = 0
      const notes = []

      for (const ps of pc.sites) {
        let site = await Site.findOne({ client: client._id, name: exactRe(ps.name) })
        if (!site) {
          site = new Site({ client: client._id, name: ps.name, createdBy: req.user._id })
          sitesCreated++
        }

        if (ps.address.street)      site.address.street      = ps.address.street
        if (ps.address.city)        site.address.city        = ps.address.city
        if (ps.address.governorate) site.address.governorate = ps.address.governorate
        if (ps.hasPack)             site.hasPack             = true
        if (ps.notes.length)        site.notes               = mergeNotes(site.notes, ps.notes)
        site.contacts = mergePeople(site.contacts, ps.contacts)

        const used = new Map()
        for (const pd of ps.deas) {
          const productId = modelMap.get(keyOf(pd.model)) || null
          const { dea, created } = upsertDea(site, pd, productId, used, partsMap)
          pd.ref = dea
          if (created) deasCreated++; else deasUpdated++
        }

        await site.save()

        // Une fois le site enregistré, les DAE ont un _id : le stock peut suivre.
        for (const pd of ps.deas) {
          const dea = site.deas.id(pd.ref?._id) || pd.ref
          if (!dea) continue
          try {
            if (opts.createStockItems) {
              const item = await attachStockItem(site, dea, req.user._id)
              if (item) { itemsCreated++; await syncProductStock(item.product) }
              // Ses batteries, électrodes et armoire : un article « installé »
              // chacune, pour que leur fiche produit les compte chez le client.
              partItemsCreated += await attachMountedParts(site, dea, { userId: req.user._id })
            } else {
              await syncDeaWithItem(site, dea)
            }
          } catch (err) {
            notes.push(`Stock non mis à jour pour ${dea.serialNumber || dea.deviceType} : ${err.message}`)
          }
        }

        let contractId = null
        if (opts.createContracts && ps.underContract && !ps.closed && site.deas.length) {
          try {
            const price = ps.price ? Number(ps.price) : null
            const { contract, created } = await ensureContract(site, client, price, nextNumber, req.user._id)
            contractId = contract._id
            if (created) contractsCreated++
          } catch (err) {
            notes.push(`Contrat non créé pour « ${site.name} » : ${err.message}`)
          }
        }

        try {
          const planned = await planSiteControls(site, ps, client.name, contractId, opts, req.user._id)
          controlsPlanned += planned.planned
          controlsHistory += planned.history
        } catch (err) {
          notes.push(`Visites non planifiées pour « ${site.name} » : ${err.message}`)
        }
      }

      /* Un client est « sous contrat » dès qu'un de ses sites a un contrat
         actif. Sans création de contrats, la case du fichier fait foi. */
      if (opts.createContracts) {
        const n = await Contract.countDocuments({ client: client._id, isActive: true, status: 'actif' })
        client.underContract = n > 0
      } else if (pc.rows.some(r => r.underContract)) {
        client.underContract = pc.sites.some(s => s.underContract)
      }
      await client.save()

      results.push({
        name: pc.name,
        success: true,
        id: client._id,
        action: clientCreated ? 'created' : 'updated',
        sites: pc.sites.length,
        sitesCreated,
        deasCreated,
        deasUpdated,
        itemsCreated,
        partItemsCreated,
        contractsCreated,
        controlsPlanned,
        controlsHistory,
        notes,
      })
    } catch (err) {
      results.push({ name: pc.name, success: false, error: err.message })
    }
  }

  const sum = key => results.reduce((n, r) => n + (r[key] || 0), 0)
  res.json({
    results,
    modelsCreated,
    partsCreated,
    reset: resetReport,
    summary: {
      imported: results.filter(r => r.success).length,
      created:  results.filter(r => r.action === 'created').length,
      updated:  results.filter(r => r.action === 'updated').length,
      failed:   results.filter(r => !r.success).length,
      sitesCreated:     sum('sitesCreated'),
      deasCreated:      sum('deasCreated'),
      deasUpdated:      sum('deasUpdated'),
      itemsCreated:     sum('itemsCreated'),
      partItemsCreated: sum('partItemsCreated'),
      contractsCreated: sum('contractsCreated'),
      controlsPlanned:  sum('controlsPlanned'),
      controlsHistory:  sum('controlsHistory'),
      modelsCreated:    modelsCreated.length,
      partsCreated:     partsCreated.length,
    },
  })
}

module.exports = { validate, execute }

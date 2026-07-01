// Source unique des catégories de produits (front).
// Le back a sa propre liste dans backend/models/Product.js — garder les `value`
// synchronisés entre les deux.
export const PRODUCT_CATEGORIES = [
  { value: 'defibrillateur',    label: 'Défibrillateur',    color: 'cat--orange' },
  { value: 'batterie',          label: 'Batterie',          color: 'cat--amber'  },
  { value: 'electrodes_adulte', label: 'Électrodes adulte', color: 'cat--blue'   },
  { value: 'electrodes_enfant', label: 'Électrodes enfant', color: 'cat--purple' },
  { value: 'boitier',           label: 'Boîtier mural',     color: 'cat--teal'   },
  { value: 'signaletique',      label: 'Signalétique',      color: 'cat--green'  },
  { value: 'accessoire',        label: 'Accessoire',        color: 'cat--gray'   },
  { value: 'kit_secours',       label: 'Kit de secours',    color: 'cat--red'    },
  { value: 'mannequin',         label: 'Mannequin',         color: 'cat--pink'   },
  { value: 'trainer',           label: 'Trainer',           color: 'cat--indigo' },
  { value: 'autre',             label: 'Autre',             color: 'cat--gray'   },
]

export const CATEGORY_MAP = Object.fromEntries(PRODUCT_CATEGORIES.map(c => [c.value, c]))

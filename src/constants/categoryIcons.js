import {
  HeartPulse, Archive, Zap, BatteryMedium, Signpost, Package, Box,
  Briefcase, ShieldCheck, Siren, Stethoscope, Wrench, BookOpen,
  GraduationCap, Truck, Layers, Tag, Cpu, Cross, LifeBuoy,
} from 'lucide-react'

/* Icônes proposées dans le sélecteur des paramètres. La clé est stockée en base
   (ProductCategory.icon) — ajouter une entrée ici suffit à l'exposer. */
export const CATEGORY_ICONS = {
  HeartPulse, Archive, Zap, BatteryMedium, Signpost, Package, Box,
  Briefcase, ShieldCheck, Siren, Stethoscope, Wrench, BookOpen,
  GraduationCap, Truck, Layers, Tag, Cpu, Cross, LifeBuoy,
}

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS)

export const CATEGORY_COLORS = [
  { value: 'orange', label: 'Orange' },
  { value: 'amber',  label: 'Ambre'  },
  { value: 'blue',   label: 'Bleu'   },
  { value: 'purple', label: 'Violet' },
  { value: 'teal',   label: 'Turquoise' },
  { value: 'green',  label: 'Vert'   },
  { value: 'red',    label: 'Rouge'  },
  { value: 'gray',   label: 'Gris'   },
  { value: 'pink',   label: 'Rose'   },
  { value: 'indigo', label: 'Indigo' },
]

export function categoryIcon(name) {
  return CATEGORY_ICONS[name] || Package
}

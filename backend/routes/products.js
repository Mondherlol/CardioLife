const router = require('express').Router()
const { body } = require('express-validator')
const ctrl   = require('../controllers/productsController')
const upload = require('../middleware/upload')
const { protect }           = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')

const CATEGORIES = [
  'defibrillateur', 'batterie', 'electrodes_adulte', 'electrodes_enfant',
  'boitier', 'signaletique', 'accessoire', 'kit_secours', 'autre',
]

const productValidation = [
  body('name').trim().notEmpty().withMessage('Le nom du produit est requis.'),
  body('category').isIn(CATEGORIES).withMessage('Catégorie invalide.'),
  body('stock').optional({ checkFalsy: true }).isNumeric().withMessage('Stock invalide.'),
  body('alertThreshold').optional({ checkFalsy: true }).isNumeric().withMessage('Seuil d\'alerte invalide.'),
  body('purchasePrice').optional({ checkFalsy: true }).isNumeric().withMessage('Prix d\'achat invalide.'),
  body('salePrice').optional({ checkFalsy: true }).isNumeric().withMessage('Prix de vente invalide.'),
]

router.use(protect)
router.use(requirePermission('canManageStock'))

router.get('/stats',           ctrl.getStats)
router.get('/suppliers',       ctrl.getSuppliers)
router.get('/brands',          ctrl.getBrands)
router.get('/',                ctrl.getAll)
router.get('/:id',             ctrl.getById)
router.get('/:id/movements',              ctrl.getMovements)
router.post('/:id/images',                upload.single('image'), ctrl.uploadImage)
router.delete('/:id/images/:filename',    ctrl.deleteImage)
router.post('/',               productValidation, ctrl.create)
router.put('/:id',             productValidation, ctrl.update)
router.post('/:id/stock',      ctrl.adjustStock)
router.delete('/:id',          ctrl.archive)
router.put('/:id/restore',     ctrl.restore)
router.delete('/:id/permanent',ctrl.permanentDelete)

module.exports = router

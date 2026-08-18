const router = require('express').Router()
const { body } = require('express-validator')
const ctrl      = require('../controllers/productsController')
const importCtrl = require('../controllers/productImportController')
const upload    = require('../middleware/upload')
const { protect }                  = require('../middleware/auth')
const { requirePermissionToWrite } = require('../middleware/permissions')

const productValidation = [
  body('name').trim().notEmpty().withMessage('Le nom du produit est requis.'),
  body('category').trim().notEmpty().withMessage('La catégorie est requise.'),
  body('stock').optional({ checkFalsy: true }).isNumeric().withMessage('Stock invalide.'),
  body('alertThreshold').optional({ checkFalsy: true }).isNumeric().withMessage('Seuil d\'alerte invalide.'),
  body('purchasePrice').optional({ checkFalsy: true }).isNumeric().withMessage('Prix d\'achat invalide.'),
  body('salePrice').optional({ checkFalsy: true }).isNumeric().withMessage('Prix de vente invalide.'),
]

router.use(protect)
// Le catalogue est consultable par tous : la pose d'un DEA en dépend. Seules
// les modifications restent réservées à la gestion du stock.
router.use(requirePermissionToWrite('canManageStock'))

/* Import / export Excel du catalogue — déclarés avant `/:id`, qui avalerait
   sinon « import » et « export » comme des identifiants. */
router.get('/export',            importCtrl.exportAll)
router.post('/import/validate',  importCtrl.validate)
router.post('/import/execute',   importCtrl.execute)

router.get('/stats',           ctrl.getStats)
router.get('/suppliers',       ctrl.getSuppliers)
router.get('/brands',          ctrl.getBrands)
router.get('/',                ctrl.getAll)
router.get('/:id',             ctrl.getById)
router.get('/:id/movements',              ctrl.getMovements)
router.get('/:id/installations',          ctrl.getClientStock)
router.post('/:id/images',                upload.single('image'), ctrl.uploadImage)
router.delete('/:id/images/:filename',    ctrl.deleteImage)
router.post('/',               productValidation, ctrl.create)
router.put('/:id',             productValidation, ctrl.update)
router.patch('/:id',           ctrl.update)
router.post('/:id/stock',      ctrl.adjustStock)
router.post('/:id/serials',    ctrl.assignSerials)
router.delete('/:id',          ctrl.archive)
router.put('/:id/restore',     ctrl.restore)
router.delete('/:id/permanent',ctrl.permanentDelete)

module.exports = router

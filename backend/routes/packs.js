const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../controllers/packsController')
const { protect }           = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')

const packValidation = [
  body('name').trim().notEmpty().withMessage('Le nom du pack est requis.'),
  body('realPrice').optional({ checkFalsy: true }).isNumeric().withMessage('Prix réel invalide.'),
]

router.use(protect)
router.use(requirePermission('canManageStock'))

router.get('/',                 ctrl.getAll)
router.get('/:id',              ctrl.getById)
router.post('/',                packValidation, ctrl.create)
router.put('/:id',              packValidation, ctrl.update)
router.delete('/:id',           ctrl.archive)
router.put('/:id/restore',      ctrl.restore)
router.delete('/:id/permanent', ctrl.permanentDelete)

module.exports = router

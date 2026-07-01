const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../controllers/contractsController')
const { protect }           = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')

const contractValidation = [
  body('client').notEmpty().withMessage('Le client est requis.'),
]

router.use(protect)
router.use(requirePermission('canManageContracts'))

router.get('/next-number',      ctrl.generateNumber)
router.get('/stats',            ctrl.getStats)
router.get('/',                 ctrl.getAll)
router.get('/:id',              ctrl.getById)
router.post('/',                contractValidation, ctrl.create)
router.put('/:id',              contractValidation, ctrl.update)
router.delete('/:id',           ctrl.archive)
router.put('/:id/restore',      ctrl.restore)
router.delete('/:id/permanent', ctrl.permanentDelete)

module.exports = router

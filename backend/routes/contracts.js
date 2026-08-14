const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../controllers/contractsController')
const { protect }           = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')

// Le contrat couvre un site ; son client s'en déduit côté serveur.
const createValidation = [
  body('site').notEmpty().withMessage('Le site est requis.'),
]

// À la modification, seuls le numéro, la période, le statut et les notes
// bougent : le site du contrat ne change pas.
const updateValidation = []

router.use(protect)
router.use(requirePermission('canManageContracts'))

router.get('/next-number',      ctrl.generateNumber)
router.get('/stats',            ctrl.getStats)
router.get('/',                 ctrl.getAll)
router.get('/:id',              ctrl.getById)
router.post('/',                createValidation, ctrl.create)
router.put('/:id',              updateValidation, ctrl.update)
router.delete('/:id',           ctrl.archive)
router.put('/:id/restore',      ctrl.restore)
router.delete('/:id/permanent', ctrl.permanentDelete)

module.exports = router

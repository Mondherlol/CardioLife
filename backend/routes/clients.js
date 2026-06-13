const router = require('express').Router()
const { body } = require('express-validator')
const ctrl       = require('../controllers/clientsController')
const importCtrl = require('../controllers/clientImportController')
const { protect }           = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')

const createValidation = [
  body('name').trim().notEmpty().withMessage('Le nom du client est requis.'),
  body('type').trim().notEmpty().withMessage('Le type de client est requis.'),
  body('contact.emails.*')
    .optional({ checkFalsy: true })
    .isEmail().withMessage('Email de contact invalide.'),
]

router.use(protect)
router.use(requirePermission('canManageClients'))

router.post('/import/validate',         importCtrl.validate)
router.post('/import/execute',          importCtrl.execute)
router.get('/',                        ctrl.getAll)
router.get('/:id',                     ctrl.getById)
router.post('/',    createValidation,  ctrl.create)
router.put('/:id',  createValidation,  ctrl.update)
router.delete('/:id',                  ctrl.archive)
router.put('/:id/restore',             ctrl.restore)
router.put('/:id/documents',           ctrl.updateDocuments)
router.delete('/:id/permanent',        ctrl.permanentDelete)

module.exports = router

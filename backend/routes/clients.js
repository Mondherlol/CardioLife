const router = require('express').Router()
const { body } = require('express-validator')
const ctrl       = require('../controllers/clientsController')
const importCtrl = require('../controllers/clientImportController')
const { protect }           = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')

const createValidation = [
  body('name').trim().notEmpty().withMessage('Le nom du client est requis.'),
  body('type').trim().notEmpty().withMessage('Le type de client est requis.'),
  body('contacts.*.email')
    .optional({ checkFalsy: true })
    .isEmail().withMessage('Email de contact invalide.'),
  body('internalManagers.*.email')
    .optional({ checkFalsy: true })
    .isEmail().withMessage('Email de responsable invalide.'),
]

router.use(protect)

// Lookup léger, accessible à tout utilisateur connecté (ex: assigner un document,
// créer une formation) sans nécessiter le droit canManageClients.
router.get('/lookup', ctrl.lookup)

router.use(requirePermission('canManageClients'))

router.post('/import/validate',         importCtrl.validate)
router.post('/import/execute',          importCtrl.execute)
router.get('/',                        ctrl.getAll)
router.get('/:id',                     ctrl.getById)
router.post('/',    createValidation,  ctrl.create)
router.put('/:id',  createValidation,  ctrl.update)
router.delete('/:id',                  ctrl.archive)
router.put('/:id/restore',             ctrl.restore)
router.get('/:id/documents-folder',    ctrl.getDocumentsFolder)
router.delete('/:id/permanent',        ctrl.permanentDelete)

module.exports = router

const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../controllers/sitesController')
const { protect }           = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')

const createValidation = [
  body('client').trim().notEmpty().withMessage('Le client est requis.'),
  body('name').trim().notEmpty().withMessage('Le nom du site est requis.'),
  body('contacts.*.email')
    .optional({ checkFalsy: true })
    .isEmail().withMessage('Email de responsable invalide.'),
]

const updateValidation = [
  body('name').optional().trim().notEmpty().withMessage('Le nom du site est requis.'),
  body('contacts.*.email')
    .optional({ checkFalsy: true })
    .isEmail().withMessage('Email de responsable invalide.'),
]

router.use(protect)

// Parc des DEA en lecture seule : alimente la page « DAE installés », ouverte à
// tout utilisateur connecté sans le droit de gestion des clients.
router.get('/deas', ctrl.listDeas)

// Lookup léger (nom, adresse, parc) : programmer un contrôle suppose de choisir
// un site, sans pour autant donner le droit de gérer les clients.
router.get('/lookup', ctrl.lookup)

router.use(requirePermission('canManageClients'))

router.get('/',        ctrl.getAll)
router.get('/:id/history',           ctrl.getHistory)
router.get('/:id/documents-folder',  ctrl.getDocumentsFolder)
router.get('/:id',     ctrl.getById)
router.post('/',       createValidation, ctrl.create)
router.put('/:id',     updateValidation, ctrl.update)
router.delete('/:id',  ctrl.remove)

router.post('/:id/deas',           ctrl.addDea)
router.put('/:id/deas/:deaId',     ctrl.updateDea)
router.delete('/:id/deas/:deaId',  ctrl.removeDea)

module.exports = router

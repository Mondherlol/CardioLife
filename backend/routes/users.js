const router = require('express').Router()
const { body } = require('express-validator')
const ctrl   = require('../controllers/usersController')
const { protect }                   = require('../middleware/auth')
const { requireAdminOrSuperAdmin }  = require('../middleware/permissions')

const createValidation = [
  body('username').trim().notEmpty().withMessage('Identifiant requis.'),
  body('fullName').trim().notEmpty().withMessage('Nom complet requis.'),
  body('email').isEmail().withMessage('Email invalide.'),
  body('password').isLength({ min: 5 }).withMessage('Mot de passe : 5 caractères minimum.'),
  body('role').optional().isIn(['superadmin','admin','technicien','commercial','assistante','readonly']),
]

router.use(protect, requireAdminOrSuperAdmin)

router.get('/',                        ctrl.getAll)
router.get('/:id',                     ctrl.getById)
router.post('/',    createValidation,  ctrl.create)
router.put('/:id',                     ctrl.updateUser)
router.put('/:id/reset-password',      ctrl.resetPassword)
router.delete('/:id',                  ctrl.remove)

module.exports = router

const router = require('express').Router()
const { body } = require('express-validator')
const ctrl   = require('../controllers/usersController')
const { protect }                   = require('../middleware/auth')
const { requireModule }             = require('../middleware/access')
const { PASSWORD_MIN_LENGTH } = require('../config/auth')

const createValidation = [
  body('username').trim().notEmpty().withMessage('Identifiant requis.'),
  body('fullName').trim().notEmpty().withMessage('Nom complet requis.'),
  body('email').isEmail().withMessage('Email invalide.'),
  body('password').isLength({ min: PASSWORD_MIN_LENGTH })
    .withMessage(`Mot de passe : ${PASSWORD_MIN_LENGTH} caractères minimum.`),
  body('role').optional().isIn(['superadmin','admin','technicien','commercial','assistante','readonly']),
]

// `canManageUsers` ouvrait une case sans effet : les routes ne
// regardaient que le rôle. Le module « settings » couvre les deux.
router.use(protect, requireModule('settings'))

router.get('/',                        ctrl.getAll)
router.get('/:id',                     ctrl.getById)
router.post('/',    createValidation,  ctrl.create)
router.put('/:id',                     ctrl.updateUser)
router.put('/:id/reset-password',      ctrl.resetPassword)
router.delete('/:id',                  ctrl.remove)

module.exports = router

const router = require('express').Router()
const ctrl   = require('../controllers/appSettingsController')
const { protect }                  = require('../middleware/auth')
const { requireAdminOrSuperAdmin, requireSuperAdmin } = require('../middleware/permissions')

router.use(protect)
router.get('/', ctrl.get)
router.put('/', requireAdminOrSuperAdmin, ctrl.update)
// Logo imprimé en tête des documents.
router.post('/logo',   requireAdminOrSuperAdmin, ctrl.uploadLogo, ctrl.setLogo)
router.delete('/logo', requireAdminOrSuperAdmin, ctrl.deleteLogo)
// Remise à zéro des données métier — irréversible, super admin uniquement.
router.post('/reset', requireSuperAdmin, ctrl.reset)

module.exports = router

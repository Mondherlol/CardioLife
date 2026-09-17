const router = require('express').Router()
const ctrl   = require('../controllers/appSettingsController')
const backup = require('../controllers/backupController')
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
// Sauvegarde complète (base + fichiers) : contient les hash de mots de passe,
// super admin uniquement dans les deux sens.
router.get('/backup', requireSuperAdmin, backup.download)
router.post('/backup/restore', requireSuperAdmin, (req, res, next) => {
  backup.uploadBackup(req, res, err => (err ? res.status(422).json({ message: err.message }) : next()))
}, backup.restore)

module.exports = router

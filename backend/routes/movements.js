const router = require('express').Router()
const { protect }           = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')
const ctrl = require('../controllers/movementsController')

router.use(protect)
router.use(requirePermission('canManageStock'))

router.get('/', ctrl.getAll)

module.exports = router

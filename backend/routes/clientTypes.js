const router = require('express').Router()
const ctrl = require('../controllers/clientTypesController')
const { protect }           = require('../middleware/auth')
const { requireSuperAdmin } = require('../middleware/permissions')

router.use(protect)

router.get('/',        ctrl.getAll)
router.post('/',       requireSuperAdmin, ctrl.create)
router.delete('/:id',  requireSuperAdmin, ctrl.remove)

module.exports = router

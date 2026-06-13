const router = require('express').Router()
const ctrl   = require('../controllers/interventionsController')
const { protect } = require('../middleware/auth')

router.use(protect)

// Must be before /:id to avoid conflict
router.get('/search-installations', ctrl.searchInstallations)

router.get('/',        ctrl.getAll)
router.get('/:id',     ctrl.getOne)
router.post('/',       ctrl.create)
router.put('/:id',     ctrl.update)
router.patch('/:id/rapport', ctrl.submitRapport)
router.delete('/:id',  ctrl.remove)

module.exports = router

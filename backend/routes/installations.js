const router = require('express').Router()
const ctrl   = require('../controllers/installationsController')
const { protect } = require('../middleware/auth')

// Le contrôle d'accès fin (gestionnaire de parc OU technicien assigné) est géré
// dans le contrôleur, car les techniciens accèdent à leurs poses assignées.
router.use(protect)

router.get('/',            ctrl.getAll)
router.get('/:id',         ctrl.getById)
router.post('/',           ctrl.create)
router.put('/:id',         ctrl.update)
router.post('/:id/complete', ctrl.complete)
router.delete('/:id',      ctrl.remove)

module.exports = router

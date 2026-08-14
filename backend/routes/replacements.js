const router = require('express').Router()
const ctrl = require('../controllers/replacementsController')
const { protect } = require('../middleware/auth')

router.use(protect)

/* Signaler une pièce défectueuse est ouvert à tous : c'est le technicien sur
   place qui la constate. Le traitement, lui, est vérifié dans le contrôleur —
   il touche au stock. */
router.get('/',     ctrl.getAll)
router.get('/:id',  ctrl.getById)
router.post('/',    ctrl.create)
router.patch('/:id', ctrl.update)
router.delete('/:id', ctrl.remove)

module.exports = router

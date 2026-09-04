const router = require('express').Router()
const ctrl   = require('../controllers/todosController')
const { protect }           = require('../middleware/auth')
const { requireAdminOrSuperAdmin } = require('../middleware/permissions')
const uploadTodo = require('../middleware/uploadTodo')

/* Suivi interne : réservé à l'administration, sans permission dédiée. Ce n'est
   pas un module métier — c'est le tableau de bord du chantier logiciel. */
router.use(protect, requireAdminOrSuperAdmin)

router.get('/',    ctrl.getAll)
router.post('/',   ctrl.create)
router.put('/reorder', ctrl.reorder)
router.patch('/:id',   ctrl.update)
router.delete('/:id',  ctrl.remove)

router.post('/:id/images', uploadTodo.single('image'), ctrl.addImage)
router.delete('/:id/images/:filename', ctrl.removeImage)

module.exports = router

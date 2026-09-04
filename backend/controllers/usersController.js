const { validationResult } = require('express-validator')
const User = require('../models/User')
const { isAdmin, defaultPermissionsForRole } = require('../middleware/access')
const { PASSWORD_MIN_LENGTH } = require('../config/auth')

async function getAll(req, res) {
  const users = await User.find().select('-password').sort({ createdAt: -1 })
  res.json(users)
}

async function getById(req, res) {
  const user = await User.findById(req.params.id).select('-password')
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' })
  res.json(user)
}

async function create(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() })

  const { username, fullName, email, password, role, permissions } = req.body

  // Seul un Super Admin fabrique un Super Admin ; et `canManageUsers` seul ne
  // doit pas servir à se hisser au rang d'admin.
  if (req.user.role !== 'superadmin' && role === 'superadmin') {
    return res.status(403).json({ message: 'Seul un Super Admin peut créer un Super Admin.' })
  }

  if (role === 'admin' && !isAdmin(req.user)) {
    return res.status(403).json({ message: 'Seul un Admin peut attribuer le rôle Admin.' })
  }

  const exists = await User.findOne({ $or: [{ username }, { email }] })
  if (exists) {
    return res.status(409).json({ message: "Nom d'utilisateur ou email déjà utilisé." })
  }

  // Un rôle sans permissions explicites (script, appel API direct) prend le
  // préréglage du métier plutôt qu'un compte sans aucun accès.
  const finalRole = role || 'readonly'
  const user = await User.create({
    username,
    fullName,
    email,
    password,
    role:        finalRole,
    permissions: permissions || defaultPermissionsForRole(finalRole),
    createdBy:   req.user._id,
  })

  res.status(201).json({
    id:          user._id,
    username:    user.username,
    fullName:    user.fullName,
    email:       user.email,
    role:        user.role,
    permissions: user.permissions,
    isActive:    user.isActive,
  })
}

async function updateUser(req, res) {
  const { fullName, email, username, role, permissions, isActive } = req.body

  const target = await User.findById(req.params.id).select('-password')
  if (!target) return res.status(404).json({ message: 'Utilisateur introuvable.' })

  // Un Super Admin ne se modifie que par un Super Admin.
  if (req.user.role !== 'superadmin' && target.role === 'superadmin') {
    return res.status(403).json({ message: 'Seul un Super Admin peut modifier un Super Admin.' })
  }
  if (req.user.role !== 'superadmin' && role === 'superadmin') {
    return res.status(403).json({ message: 'Seul un Super Admin peut attribuer le rôle Super Admin.' })
  }

  if (role === 'admin' && !isAdmin(req.user)) {
    return res.status(403).json({ message: 'Seul un Admin peut attribuer le rôle Admin.' })
  }

  if (target.role === 'admin' && !isAdmin(req.user)) {
    return res.status(403).json({ message: 'Seul un Admin peut modifier un Admin.' })
  }

  // Personne n'élargit ses propres droits : sans cela, `canManageUsers` suffit
  // à se cocher toutes les autres cases.
  const isSelf = String(target._id) === String(req.user._id)
  if (isSelf && req.user.role !== 'superadmin'
      && (role !== undefined || permissions !== undefined || isActive !== undefined)) {
    return res.status(403).json({
      message: 'Vous ne pouvez pas modifier votre propre rôle ni vos propres permissions.',
    })
  }

  const update = {}
  if (fullName    !== undefined) update.fullName    = fullName
  if (email       !== undefined) update.email       = email
  if (username    !== undefined) update.username    = username
  if (role        !== undefined) update.role        = role
  if (permissions !== undefined) update.permissions = permissions
  if (isActive    !== undefined) update.isActive    = isActive

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { new: true, runValidators: true }
  ).select('-password')

  res.json(user)
}

async function resetPassword(req, res) {
  const { newPassword } = req.body
  if (!newPassword || newPassword.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({
      message: `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`,
    })
  }

  const target = await User.findById(req.params.id)
  if (!target) return res.status(404).json({ message: 'Utilisateur introuvable.' })

  if (req.user.role !== 'superadmin' && target.role === 'superadmin') {
    return res.status(403).json({ message: 'Seul un Super Admin peut modifier le mot de passe d\'un Super Admin.' })
  }
  if (target.role === 'admin' && !isAdmin(req.user)) {
    return res.status(403).json({ message: "Seul un Admin peut réinitialiser le mot de passe d'un Admin." })
  }

  target.password = newPassword
  await target.save()

  res.json({ message: 'Mot de passe réinitialisé.' })
}

async function remove(req, res) {
  const user = await User.findById(req.params.id)
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' })

  if (user.role === 'superadmin') {
    return res.status(403).json({ message: 'Impossible de supprimer un Super Admin.' })
  }
  if (user.role === 'admin' && !isAdmin(req.user)) {
    return res.status(403).json({ message: 'Seul un Admin peut supprimer un Admin.' })
  }
  if (String(user._id) === String(req.user._id)) {
    return res.status(403).json({ message: 'Vous ne pouvez pas supprimer votre propre compte.' })
  }

  await user.deleteOne()
  res.json({ message: 'Utilisateur supprimé.' })
}

module.exports = { getAll, getById, create, updateUser, resetPassword, remove }

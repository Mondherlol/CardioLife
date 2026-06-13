const { validationResult } = require('express-validator')
const User = require('../models/User')

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

  // Admin cannot create superadmins
  if (req.user.role === 'admin' && role === 'superadmin') {
    return res.status(403).json({ message: 'Les admins ne peuvent pas créer un Super Admin.' })
  }

  const exists = await User.findOne({ $or: [{ username }, { email }] })
  if (exists) {
    return res.status(409).json({ message: "Nom d'utilisateur ou email déjà utilisé." })
  }

  const user = await User.create({
    username,
    fullName,
    email,
    password,
    role:        role        || 'readonly',
    permissions: permissions || {},
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

  // Admin cannot manage superadmins
  if (req.user.role === 'admin' && target.role === 'superadmin') {
    return res.status(403).json({ message: 'Les admins ne peuvent pas modifier un Super Admin.' })
  }
  // Admin cannot assign superadmin role
  if (req.user.role === 'admin' && role === 'superadmin') {
    return res.status(403).json({ message: 'Les admins ne peuvent pas attribuer le rôle Super Admin.' })
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
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ message: 'Le mot de passe doit faire au moins 8 caractères.' })
  }

  const target = await User.findById(req.params.id)
  if (!target) return res.status(404).json({ message: 'Utilisateur introuvable.' })

  // Admin cannot reset superadmin password
  if (req.user.role === 'admin' && target.role === 'superadmin') {
    return res.status(403).json({ message: 'Les admins ne peuvent pas modifier le mot de passe d\'un Super Admin.' })
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

  await user.deleteOne()
  res.json({ message: 'Utilisateur supprimé.' })
}

module.exports = { getAll, getById, create, updateUser, resetPassword, remove }

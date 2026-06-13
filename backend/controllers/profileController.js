const path = require('path')
const fs   = require('fs')
const User = require('../models/User')

/* ─── GET /api/profile ─── */
async function getProfile(req, res) {
  try {
    const user = await User.findById(req.user._id).select('-password')
    res.json(user)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── PATCH /api/profile ─── */
async function updateProfile(req, res) {
  try {
    const { fullName, email, phones } = req.body
    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' })

    if (fullName !== undefined) user.fullName = fullName.trim()
    if (email    !== undefined) user.email    = email.trim().toLowerCase()
    if (phones   !== undefined) user.phones   = phones.filter(p => p.trim())

    await user.save()
    const { password: _pw, ...data } = user.toObject()
    res.json(data)
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Cet email est déjà utilisé.' })
    res.status(500).json({ message: err.message })
  }
}

/* ─── POST /api/profile/password ─── */
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Tous les champs sont requis.' })
    if (newPassword.length < 8)
      return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 8 caractères.' })

    const user = await User.findById(req.user._id).select('+password')
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' })

    const valid = await user.comparePassword(currentPassword)
    if (!valid) return res.status(400).json({ message: 'Mot de passe actuel incorrect.' })

    user.password = newPassword
    await user.save()
    res.json({ message: 'Mot de passe mis à jour.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── POST /api/profile/avatar ─── */
async function uploadAvatar(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'Aucun fichier fourni.' })

    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' })

    if (user.avatar) {
      fs.unlink(path.join(__dirname, '..', 'uploads', 'avatars', user.avatar), () => {})
    }

    user.avatar = req.file.filename
    await user.save()
    const { password: _pw, ...data } = user.toObject()
    res.json(data)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

/* ─── DELETE /api/profile/avatar ─── */
async function deleteAvatar(req, res) {
  try {
    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' })

    if (user.avatar) {
      fs.unlink(path.join(__dirname, '..', 'uploads', 'avatars', user.avatar), () => {})
      user.avatar = null
      await user.save()
    }

    const { password: _pw, ...data } = user.toObject()
    res.json(data)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

module.exports = { getProfile, updateProfile, changePassword, uploadAvatar, deleteAvatar }

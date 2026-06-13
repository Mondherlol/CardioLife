import { get, patch, post, del, upload, STATIC_BASE } from './http'

export const getProfile     = ()     => get('/profile')
export const updateProfile  = (data) => patch('/profile', data)
export const changePassword = (data) => post('/profile/password', data)
export const deleteAvatar   = ()     => del('/profile/avatar')

export const uploadAvatar = (file) => {
  const form = new FormData()
  form.append('avatar', file)
  return upload('/profile/avatar', form)
}

export const avatarUrl = (filename) => `${STATIC_BASE}/uploads/avatars/${filename}`

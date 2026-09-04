import { get, post, patch, put, del, upload, STATIC_BASE } from './http'

const qs = (params) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  ).toString()
  return s ? `?${s}` : ''
}

export const getTodos    = (params = {}) => get(`/todos${qs(params)}`)
export const createTodo  = (data)        => post('/todos', data)
export const updateTodo  = (id, data)    => patch(`/todos/${id}`, data)
export const reorderTodos = (ids)        => put('/todos/reorder', { ids })
export const deleteTodo  = (id)          => del(`/todos/${id}`)

export const uploadTodoImage = (id, file) => {
  const form = new FormData()
  form.append('image', file)
  return upload(`/todos/${id}/images`, form)
}
export const deleteTodoImage = (id, filename) => del(`/todos/${id}/images/${filename}`)

export const todoImageUrl = (filename) => `${STATIC_BASE}/uploads/todos/${filename}`

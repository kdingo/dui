import { FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import type { User } from '../api/types'
import { useConfirm } from '../components/ConfirmDialog'
import { Flash } from '../components/Flash'
import { errorMessage } from '../i18n/apiError'

const emptyForm = {
  username: '',
  role: 'viewer' as User['role'],
  password: '',
}

export function UsersPage() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<User[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingUsername, setEditingUsername] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const confirm = useConfirm()

  const adminCount = users.filter((user) => user.role === 'admin').length

  function isLastAdmin(user: User) {
    return user.role === 'admin' && adminCount === 1
  }

  const editingUser = users.find((user) => user.username === editingUsername)
  const editingLastAdmin = Boolean(editingUser && isLastAdmin(editingUser))

  useEffect(() => {
    api
      .listUsers()
      .then((result) => setUsers(result.users))
      .catch((err) => setError(errorMessage(err, t('common.loadFailed'))))
  }, [])

  function resetForm() {
    setForm(emptyForm)
    setEditingUsername(null)
  }

  function startEdit(user: User) {
    setEditingUsername(user.username)
    setForm({ username: user.username, role: user.role, password: '' })
    setError('')
    setMessage('')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      const result = editingUsername
        ? await api.updateUser(editingUsername, {
            role: form.role,
            ...(form.password ? { password: form.password } : {}),
          })
        : await api.createUser({
            username: form.username,
            role: form.role,
            password: form.password,
          })
      setUsers(result.users)
      setMessage(editingUsername ? t('users.updated') : t('users.created'))
      resetForm()
    } catch (err) {
      setError(errorMessage(err, t('common.saveFailed')))
    }
  }

  async function removeUser(user: User) {
    if (isLastAdmin(user)) return
    const confirmed = await confirm({
      title: t('users.deleteTitle', { username: user.username }),
      message: t('users.deleteMessage'),
      confirmLabel: t('users.deleteConfirm'),
      danger: true,
    })
    if (!confirmed) return
    setError('')
    setMessage('')
    try {
      const result = await api.deleteUser(user.username)
      setUsers(result.users)
      setMessage(t('users.deleted', { username: user.username }))
      if (editingUsername === user.username) resetForm()
    } catch (err) {
      setError(errorMessage(err, t('common.deleteFailed')))
    }
  }

  return (
    <div>
      <h2>{t('users.title')}</h2>
      <Flash kind="error" message={error} />
      <Flash message={message} />

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>{t('users.username')}</th>
              <th>{t('users.role')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.username}>
                <td>{user.username}</td>
                <td>{t(`users.roles.${user.role}`)}</td>
                <td className="actions">
                  <button className="secondary" onClick={() => startEdit(user)}>
                    {t('common.edit')}
                  </button>
                  <button
                    className="danger"
                    onClick={() => removeUser(user)}
                    disabled={isLastAdmin(user)}
                    title={isLastAdmin(user) ? t('users.lastAdmin') : undefined}
                  >
                    {t('common.delete')}
                  </button>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={3}>{t('users.empty')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h3>{editingUsername ? t('users.editTitle') : t('users.addTitle')}</h3>
        <label>
          {t('users.username')}
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
            disabled={Boolean(editingUsername)}
            autoComplete="off"
          />
        </label>
        <label>
          {t('users.role')}
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}
          >
            <option value="admin">{t('users.roles.admin')}</option>
            <option value="viewer" disabled={editingLastAdmin}>
              {t('users.roles.viewer')}
            </option>
          </select>
        </label>
        <label>
          {editingUsername ? t('users.newPasswordOptional') : t('users.password')}
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required={!editingUsername}
            autoComplete="new-password"
          />
        </label>
        <div className="actions">
          <button className="primary" type="submit">
            {editingUsername ? t('users.save') : t('users.create')}
          </button>
          {editingUsername && (
            <button className="secondary" type="button" onClick={resetForm}>
              {t('common.cancel')}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

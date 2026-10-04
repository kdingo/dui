import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { User } from '../api/types'
import { useConfirm } from '../components/ConfirmDialog'
import { Flash } from '../components/Flash'
import { PasswordRequirements } from '../components/PasswordRequirements'
import { DEFAULT_POLICY, passwordRequirements } from '../lib/passwordPolicy'

const emptyForm = {
  username: '',
  role: 'viewer' as User['role'],
  password: '',
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingUsername, setEditingUsername] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [policy, setPolicy] = useState(DEFAULT_POLICY)
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
      .catch((err) => setError(err.message))
    api
      .passwordPolicy()
      .then(setPolicy)
      .catch(() => undefined)
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
      setMessage(editingUsername ? 'User updated.' : 'User created.')
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function removeUser(user: User) {
    if (isLastAdmin(user)) return
    const confirmed = await confirm({
      title: `Delete user "${user.username}"?`,
      message: 'They will no longer be able to sign in.',
      confirmLabel: 'Delete user',
      danger: true,
    })
    if (!confirmed) return
    setError('')
    setMessage('')
    try {
      const result = await api.deleteUser(user.username)
      setUsers(result.users)
      setMessage(`User "${user.username}" deleted.`)
      if (editingUsername === user.username) resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div>
      <h2>Users</h2>
      <Flash kind="error" message={error} />
      <Flash message={message} />

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.username}>
                <td>{user.username}</td>
                <td>{user.role}</td>
                <td className="actions">
                  <button className="secondary" onClick={() => startEdit(user)}>
                    Edit
                  </button>
                  <button
                    className="danger"
                    onClick={() => removeUser(user)}
                    disabled={isLastAdmin(user)}
                    title={isLastAdmin(user) ? 'Cannot delete the last admin' : undefined}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={3}>No users configured.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="panel form-grid" onSubmit={handleSubmit}>
        <h3>{editingUsername ? 'Edit user' : 'Add user'}</h3>
        <label>
          Username
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
            disabled={Boolean(editingUsername)}
            autoComplete="off"
          />
        </label>
        <label>
          Role
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}
          >
            <option value="admin">admin</option>
            <option value="viewer" disabled={editingLastAdmin}>
              viewer
            </option>
          </select>
        </label>
        <label>
          {editingUsername ? 'New password (optional)' : 'Password'}
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required={!editingUsername}
            minLength={policy.min_length}
            autoComplete="new-password"
          />
        </label>
        {(form.password || !editingUsername) && (
          <PasswordRequirements
            requirements={passwordRequirements(policy, form.password, editingUsername ?? form.username)}
          />
        )}
        <div className="actions">
          <button className="primary" type="submit">
            {editingUsername ? 'Save user' : 'Create user'}
          </button>
          {editingUsername && (
            <button className="secondary" type="button" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

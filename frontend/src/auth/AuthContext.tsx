import { createContext, useContext } from 'react'
import type { User } from '../api/types'

interface AuthContextValue {
  user: User | null
  setUser: (user: User | null) => void
  isAdmin: boolean
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: () => undefined,
  isAdmin: false,
})

export function useAuth() {
  return useContext(AuthContext)
}

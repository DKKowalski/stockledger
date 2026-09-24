import { createContext, useContext } from 'react';
import type { User } from './types';

export type AuthState = {
  accessToken: string | null;
  user: User | null;
  restoring: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  registerOwner: (body: { fullName: string; businessName: string; email: string; password: string }) => Promise<void>;
  signOut: () => void;
  updateProfile: (body: { fullName: string; email: string }) => Promise<User>;
  changePassword: (body: { currentPassword: string; newPassword: string }) => Promise<void>;
};

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('Missing AuthProvider');
  return auth;
}

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcrypt';
import { getDb } from '@/lib/db';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        console.log('[AUTH] authorize called with username:', credentials?.username);
        
        try {
          if (!credentials?.username || !credentials?.password) {
            console.log('[AUTH] Missing credentials');
            return null;
          }

          console.log('[AUTH] Getting database...');
          const db = getDb();
          console.log('[AUTH] Database obtained, querying user...');
          
          const user = db
            .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
            .get(credentials.username) as
            | { id: string; username: string; password_hash: string }
            | undefined;

          console.log('[AUTH] User found:', !!user);

          if (!user) {
            console.log('[AUTH] User not found in database');
            return null;
          }

          console.log('[AUTH] Comparing password...');
          const isValid = await bcrypt.compare(
            credentials.password,
            user.password_hash
          );

          console.log('[AUTH] Password valid:', isValid);

          if (!isValid) {
            console.log('[AUTH] Invalid password');
            return null;
          }

          // Update last_login timestamp
          console.log('[AUTH] Updating last_login...');
          db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(
            user.id
          );

          console.log('[AUTH] Returning user object');
          return {
            id: user.id,
            name: user.username,
          };
        } catch (error) {
          console.error('[AUTH] Error in authorize:', error);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
    updateAge: 60 * 60, // Refresh token every 1 hour of activity
  },
  pages: {
    signIn: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        session.user.name = token.username as string;
      }
      return session;
    },
  },
};

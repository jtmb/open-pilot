import NextAuth, { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import CredentialsProvider from "next-auth/providers/credentials";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

function buildAuthOptions(): NextAuthOptions {
  return {
    providers: [
      GitHubProvider({
        clientId: process.env.GITHUB_ID || '',
        clientSecret: process.env.GITHUB_SECRET || '',
        authorization: {
          params: {
            scope: 'read:user user:email repo',
          },
        },
      }),
      // Offline fallback: sign in using a previously-stored user record in the local DB
      CredentialsProvider({
        id: 'stored-session',
        name: 'Stored Session',
        credentials: {
          userId: { label: 'User ID', type: 'text' },
        },
        async authorize(creds) {
          if (!creds?.userId) return null;
          try {
            const user = await prisma.user.findUnique({ where: { id: creds.userId } });
            if (!user) return null;
            return { id: user.id, name: user.name, email: user.email, image: user.image ?? undefined };
          } catch {
            return null;
          }
        },
      }),
    ],
    secret: process.env.NEXTAUTH_SECRET,
    // Explicit cookie config: force secure:false for HTTP (Docker/dev over plain HTTP)
    cookies: {
      sessionToken: {
        name: 'next-auth.session-token',
        options: { httpOnly: true, sameSite: 'lax', path: '/', secure: false },
      },
      callbackUrl: {
        name: 'next-auth.callback-url',
        options: { sameSite: 'lax', path: '/', secure: false },
      },
      csrfToken: {
        name: 'next-auth.csrf-token',
        options: { httpOnly: true, sameSite: 'lax', path: '/', secure: false },
      },
      pkceCodeVerifier: {
        name: 'next-auth.pkce.code_verifier',
        options: { httpOnly: true, sameSite: 'lax', path: '/', secure: false },
      },
      state: {
        name: 'next-auth.state',
        options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 900, secure: false },
      },
      nonce: {
        name: 'next-auth.nonce',
        options: { httpOnly: true, sameSite: 'lax', path: '/', secure: false },
      },
    },
    callbacks: {
      async signIn({ user, account }) {
        // Persist the GitHub user to the local DB so we can use it as an offline fallback
        if (account?.provider === 'github' && user.id && user.email) {
          try {
            const now = BigInt(Date.now());
            // Timeout after 5s to prevent hanging if DB is slow
            await Promise.race([
              prisma.user.upsert({
                where: { id: user.id },
                update: { name: user.name ?? '', email: user.email, image: user.image ?? null, updatedAt: now },
                create: { id: user.id, name: user.name ?? '', email: user.email, image: user.image ?? null, createdAt: now, updatedAt: now },
              }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('DB timeout')), 5000)
              ),
            ]);
          } catch (e) {
            // Non-fatal — don't block sign-in if DB write fails
            console.warn('Failed to persist user to DB:', (e as Error).message);
          }
        }
        return true;
      },
      async jwt({ token, account }) {
        // Persist the GitHub access token so we can use it for code-server auth
        if (account?.access_token) {
          token.accessToken = account.access_token;
        }
        return token;
      },
      async session({ session, token }) {
        (session as any).accessToken = token.accessToken;
        return session;
      },
      async redirect({ url, baseUrl }) {
        if (url.startsWith('/')) return `${baseUrl}${url}`;
        try {
          if (new URL(url).origin === new URL(baseUrl).origin) return url;
        } catch { /* invalid URL — fall through to baseUrl */ }
        return baseUrl;
      },
    },
  };
}

// Cache the handler and only recreate when GitHub credentials change.
// Creating a new NextAuth instance on every request generates fresh CSRF tokens,
// which overwrites the browser's CSRF cookie and breaks subsequent sign-in attempts.
let _handler: any = null;
let _cachedId = '';
let _cachedSecret = '';

function getHandler() {
  const id = process.env.GITHUB_ID || '';
  const secret = process.env.GITHUB_SECRET || '';
  if (!_handler || id !== _cachedId || secret !== _cachedSecret) {
    _handler = NextAuth(buildAuthOptions());
    _cachedId = id;
    _cachedSecret = secret;
  }
  return _handler;
}

export async function GET(req: NextRequest, ctx: any) {
  return getHandler()(req, ctx);
}

export async function POST(req: NextRequest, ctx: any) {
  return getHandler()(req, ctx);
}

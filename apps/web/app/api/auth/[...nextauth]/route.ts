import NextAuth from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import CredentialsProvider from "next-auth/providers/credentials";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Create handler per-request so updated credentials (set via UI) are always used
function makeHandler() {
  return NextAuth({
    providers: [
      GitHubProvider({
        clientId: process.env.GITHUB_ID || '',
        clientSecret: process.env.GITHUB_SECRET || '',
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
    callbacks: {
      async signIn({ user, account }) {
        // Persist the GitHub user to the local DB so we can use it as an offline fallback
        if (account?.provider === 'github' && user.id && user.email) {
          try {
            const now = BigInt(Date.now());
            await prisma.user.upsert({
              where: { id: user.id },
              update: { name: user.name ?? '', email: user.email, image: user.image ?? null, updatedAt: now },
              create: { id: user.id, name: user.name ?? '', email: user.email, image: user.image ?? null, createdAt: now, updatedAt: now },
            });
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
    },
  });
}

export async function GET(req: NextRequest, ctx: any) {
  return (makeHandler() as any)(req, ctx);
}

export async function POST(req: NextRequest, ctx: any) {
  return (makeHandler() as any)(req, ctx);
}

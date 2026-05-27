import NextAuth from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import type { NextRequest } from "next/server";

// Create handler per-request so updated credentials (set via UI) are always used
function makeHandler() {
  return NextAuth({
    providers: [
      GitHubProvider({
        clientId: process.env.GITHUB_ID || '',
        clientSecret: process.env.GITHUB_SECRET || '',
      }),
    ],
    secret: process.env.NEXTAUTH_SECRET,
    callbacks: {
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

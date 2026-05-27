import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Returns the list of locally-stored users for offline sign-in fallback.
// This endpoint is public (no auth required) so the login screen can offer
// offline access when GitHub OAuth is unavailable.
export async function GET() {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, image: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    return NextResponse.json({ users });
  } catch {
    return NextResponse.json({ users: [] });
  }
}

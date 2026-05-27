import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/** Returns the most recently updated stored user, for the offline sign-in fallback. */
export async function GET() {
  try {
    const user = await prisma.user.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, image: true, email: true },
    });
    return NextResponse.json({ user: user ?? null });
  } catch {
    return NextResponse.json({ user: null });
  }
}

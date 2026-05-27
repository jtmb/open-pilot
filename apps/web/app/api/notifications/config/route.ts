import { NextResponse } from 'next/server';
import { getNotificationConfig, setNotificationConfig, NotificationConfig } from '@/services/notificationService';

export async function GET() {
  return NextResponse.json(getNotificationConfig());
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Partial<NotificationConfig>;
    const updated = setNotificationConfig(body);
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

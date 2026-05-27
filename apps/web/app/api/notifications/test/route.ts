import { NextResponse } from 'next/server';
import { sendTestNotification, NotificationChannels } from '@/services/notificationService';

export async function POST(req: Request) {
  try {
    const { channel } = await req.json() as { channel: keyof NotificationChannels };
    if (!channel) return NextResponse.json({ error: 'channel required' }, { status: 400 });
    const result = await sendTestNotification(channel);
    const ok = result === 'ok';
    return NextResponse.json({ ok, message: ok ? 'Test notification sent' : result });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

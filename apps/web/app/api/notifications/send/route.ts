import { NextResponse } from 'next/server';
import { sendNotification, NotificationEvent } from '@/services/notificationService';

export async function POST(req: Request) {
  try {
    const { event, title, message } = await req.json() as {
      event: NotificationEvent;
      title: string;
      message: string;
    };
    if (!event || !title || !message) {
      return NextResponse.json({ error: 'event, title, and message required' }, { status: 400 });
    }
    const result = await sendNotification(event, title, message);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

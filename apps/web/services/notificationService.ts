import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

const CONFIG_PATH = path.join('/data', 'notification-config.json');

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DiscordChannelConfig {
  enabled: boolean;
  webhookUrl: string;
}

export interface SlackChannelConfig {
  enabled: boolean;
  webhookUrl: string;
}

export interface EmailChannelConfig {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  from: string;
  to: string;
}

export interface TelegramChannelConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface NtfyChannelConfig {
  enabled: boolean;
  url: string;    // e.g. https://ntfy.sh/mytopic or self-hosted
  token: string;  // optional auth token, empty = no auth
}

export interface GotifyChannelConfig {
  enabled: boolean;
  url: string;      // e.g. https://gotify.example.com
  appToken: string;
}

export interface NotificationChannels {
  discord: DiscordChannelConfig;
  slack: SlackChannelConfig;
  email: EmailChannelConfig;
  telegram: TelegramChannelConfig;
  ntfy: NtfyChannelConfig;
  gotify: GotifyChannelConfig;
}

export interface NotificationEvents {
  agentError: boolean;
  agentComplete: boolean;
  agentPaused: boolean;
  approvalRequired: boolean;
  backupFailed: boolean;
}

export interface NotificationConfig {
  enabled: boolean;
  channels: NotificationChannels;
  events: NotificationEvents;
}

const DEFAULT_CONFIG: NotificationConfig = {
  enabled: false,
  channels: {
    discord: { enabled: false, webhookUrl: '' },
    slack: { enabled: false, webhookUrl: '' },
    email: { enabled: false, smtpHost: '', smtpPort: 587, smtpSecure: false, smtpUser: '', smtpPass: '', from: '', to: '' },
    telegram: { enabled: false, botToken: '', chatId: '' },
    ntfy: { enabled: false, url: '', token: '' },
    gotify: { enabled: false, url: '', appToken: '' },
  },
  events: {
    agentError: true,
    agentComplete: true,
    agentPaused: false,
    approvalRequired: true,
    backupFailed: true,
  },
};

// ─── Config I/O ────────────────────────────────────────────────────────────────

export function getNotificationConfig(): NotificationConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<NotificationConfig>;
    // Deep merge with defaults so missing keys don't cause runtime errors
    return {
      enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
      channels: {
        discord: { ...DEFAULT_CONFIG.channels.discord, ...parsed.channels?.discord },
        slack: { ...DEFAULT_CONFIG.channels.slack, ...parsed.channels?.slack },
        email: { ...DEFAULT_CONFIG.channels.email, ...parsed.channels?.email },
        telegram: { ...DEFAULT_CONFIG.channels.telegram, ...parsed.channels?.telegram },
        ntfy: { ...DEFAULT_CONFIG.channels.ntfy, ...parsed.channels?.ntfy },
        gotify: { ...DEFAULT_CONFIG.channels.gotify, ...parsed.channels?.gotify },
      },
      events: { ...DEFAULT_CONFIG.events, ...parsed.events },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function setNotificationConfig(patch: Partial<NotificationConfig>): NotificationConfig {
  const current = getNotificationConfig();
  const next: NotificationConfig = {
    enabled: patch.enabled ?? current.enabled,
    channels: {
      discord: { ...current.channels.discord, ...patch.channels?.discord },
      slack: { ...current.channels.slack, ...patch.channels?.slack },
      email: { ...current.channels.email, ...patch.channels?.email },
      telegram: { ...current.channels.telegram, ...patch.channels?.telegram },
      ntfy: { ...current.channels.ntfy, ...patch.channels?.ntfy },
      gotify: { ...current.channels.gotify, ...patch.channels?.gotify },
    },
    events: { ...current.events, ...patch.events },
  };
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

// ─── Dispatch helpers ──────────────────────────────────────────────────────────

async function sendDiscord(cfg: DiscordChannelConfig, title: string, message: string): Promise<string> {
  if (!cfg.webhookUrl) return 'Discord webhook URL not configured';
  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `**${title}**\n${message}` }),
  });
  if (!res.ok) return `Discord HTTP ${res.status}`;
  return 'ok';
}

async function sendSlack(cfg: SlackChannelConfig, title: string, message: string): Promise<string> {
  if (!cfg.webhookUrl) return 'Slack webhook URL not configured';
  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `*${title}*\n${message}` }),
  });
  if (!res.ok) return `Slack HTTP ${res.status}`;
  return 'ok';
}

async function sendEmail(cfg: EmailChannelConfig, title: string, message: string): Promise<string> {
  if (!cfg.smtpHost || !cfg.to) return 'Email SMTP host or recipient not configured';
  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort || 587,
    secure: cfg.smtpSecure,
    auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPass } : undefined,
  });
  await transporter.sendMail({
    from: cfg.from || cfg.smtpUser || 'OpenPilot <noreply@openpilot>',
    to: cfg.to,
    subject: `OpenPilot: ${title}`,
    text: message,
    html: `<p><strong>${title}</strong></p><p>${message.replace(/\n/g, '<br>')}</p>`,
  });
  return 'ok';
}

async function sendTelegram(cfg: TelegramChannelConfig, title: string, message: string): Promise<string> {
  if (!cfg.botToken || !cfg.chatId) return 'Telegram bot token or chat ID not configured';
  const text = encodeURIComponent(`*${title}*\n${message}`);
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage?chat_id=${cfg.chatId}&text=${text}&parse_mode=Markdown`;
  const res = await fetch(url);
  if (!res.ok) return `Telegram HTTP ${res.status}`;
  return 'ok';
}

async function sendNtfy(cfg: NtfyChannelConfig, title: string, message: string): Promise<string> {
  if (!cfg.url) return 'ntfy URL not configured';
  const headers: Record<string, string> = {
    'Title': title,
    'Content-Type': 'text/plain',
  };
  if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`;
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers,
    body: message,
  });
  if (!res.ok) return `ntfy HTTP ${res.status}`;
  return 'ok';
}

async function sendGotify(cfg: GotifyChannelConfig, title: string, message: string): Promise<string> {
  if (!cfg.url || !cfg.appToken) return 'Gotify URL or app token not configured';
  const endpoint = cfg.url.replace(/\/$/, '') + '/message';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gotify-Key': cfg.appToken,
    },
    body: JSON.stringify({ title, message, priority: 5 }),
  });
  if (!res.ok) return `Gotify HTTP ${res.status}`;
  return 'ok';
}

// ─── Public API ────────────────────────────────────────────────────────────────

export type NotificationEvent = keyof NotificationEvents;

export interface SendResult {
  discord?: string;
  slack?: string;
  email?: string;
  telegram?: string;
  ntfy?: string;
  gotify?: string;
}

/**
 * Send a notification to all enabled channels if the given event is enabled.
 * Never throws — per-channel errors are returned in the result object.
 */
export async function sendNotification(
  event: NotificationEvent,
  title: string,
  message: string,
): Promise<SendResult> {
  const config = getNotificationConfig();
  const result: SendResult = {};

  // Global off switch or event disabled
  if (!config.enabled || !config.events[event]) return result;

  const { channels } = config;

  const tasks: Promise<void>[] = [];

  if (channels.discord.enabled && channels.discord.webhookUrl) {
    tasks.push(sendDiscord(channels.discord, title, message).then(r => { result.discord = r; }).catch(e => { result.discord = String(e); }));
  }
  if (channels.slack.enabled && channels.slack.webhookUrl) {
    tasks.push(sendSlack(channels.slack, title, message).then(r => { result.slack = r; }).catch(e => { result.slack = String(e); }));
  }
  if (channels.email.enabled && channels.email.smtpHost && channels.email.to) {
    tasks.push(sendEmail(channels.email, title, message).then(r => { result.email = r; }).catch(e => { result.email = String(e); }));
  }
  if (channels.telegram.enabled && channels.telegram.botToken && channels.telegram.chatId) {
    tasks.push(sendTelegram(channels.telegram, title, message).then(r => { result.telegram = r; }).catch(e => { result.telegram = String(e); }));
  }
  if (channels.ntfy.enabled && channels.ntfy.url) {
    tasks.push(sendNtfy(channels.ntfy, title, message).then(r => { result.ntfy = r; }).catch(e => { result.ntfy = String(e); }));
  }
  if (channels.gotify.enabled && channels.gotify.url && channels.gotify.appToken) {
    tasks.push(sendGotify(channels.gotify, title, message).then(r => { result.gotify = r; }).catch(e => { result.gotify = String(e); }));
  }

  await Promise.allSettled(tasks);
  return result;
}

/**
 * Send a test notification to all configured (but not necessarily enabled) channels.
 * Used from the settings panel to verify connectivity.
 */
export async function sendTestNotification(channelKey: keyof NotificationChannels): Promise<string> {
  const config = getNotificationConfig();
  const title = 'OpenPilot Test';
  const message = 'This is a test notification from OpenPilot. Your configuration is working correctly.';

  try {
    switch (channelKey) {
      case 'discord': return await sendDiscord(config.channels.discord, title, message);
      case 'slack': return await sendSlack(config.channels.slack, title, message);
      case 'email': return await sendEmail(config.channels.email, title, message);
      case 'telegram': return await sendTelegram(config.channels.telegram, title, message);
      case 'ntfy': return await sendNtfy(config.channels.ntfy, title, message);
      case 'gotify': return await sendGotify(config.channels.gotify, title, message);
      default: return 'Unknown channel';
    }
  } catch (e) {
    return String(e);
  }
}

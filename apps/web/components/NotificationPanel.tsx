'use client';
import { useCallback, useEffect, useState } from 'react';
import type { NotificationConfig, NotificationChannels } from '@/services/notificationService';

interface Props { onClose: () => void }

type ChannelKey = keyof NotificationChannels;

const CHANNELS: { key: ChannelKey; label: string; icon: string; fields: FieldDef[] }[] = [
  {
    key: 'discord',
    label: 'Discord',
    icon: '🎮',
    fields: [
      { name: 'webhookUrl', label: 'Webhook URL', type: 'url', placeholder: 'https://discord.com/api/webhooks/...' },
    ],
  },
  {
    key: 'slack',
    label: 'Slack',
    icon: '💬',
    fields: [
      { name: 'webhookUrl', label: 'Webhook URL', type: 'url', placeholder: 'https://hooks.slack.com/services/...' },
    ],
  },
  {
    key: 'email',
    label: 'Email (SMTP)',
    icon: '✉️',
    fields: [
      { name: 'smtpHost', label: 'SMTP Host', type: 'text', placeholder: 'smtp.gmail.com' },
      { name: 'smtpPort', label: 'Port', type: 'number', placeholder: '587' },
      { name: 'smtpUser', label: 'Username', type: 'text', placeholder: 'you@gmail.com' },
      { name: 'smtpPass', label: 'Password', type: 'password', placeholder: 'App password' },
      { name: 'from', label: 'From address', type: 'email', placeholder: 'OpenPilot <you@gmail.com>' },
      { name: 'to', label: 'Recipient', type: 'email', placeholder: 'you@example.com' },
    ],
  },
  {
    key: 'telegram',
    label: 'Telegram',
    icon: '✈️',
    fields: [
      { name: 'botToken', label: 'Bot Token', type: 'text', placeholder: '123456:ABC...' },
      { name: 'chatId', label: 'Chat ID', type: 'text', placeholder: '-100123456789' },
    ],
  },
  {
    key: 'ntfy',
    label: 'ntfy (self-hosted push)',
    icon: '🔔',
    fields: [
      { name: 'url', label: 'Topic URL', type: 'url', placeholder: 'https://ntfy.sh/my-secret-topic' },
      { name: 'token', label: 'Auth Token (optional)', type: 'text', placeholder: 'Leave blank for public topics' },
    ],
  },
  {
    key: 'gotify',
    label: 'Gotify',
    icon: '🚀',
    fields: [
      { name: 'url', label: 'Gotify URL', type: 'url', placeholder: 'https://gotify.example.com' },
      { name: 'appToken', label: 'App Token', type: 'text', placeholder: 'Application token' },
    ],
  },
];

const EVENTS: { key: keyof NonNullable<NotificationConfig['events']>; label: string; desc: string }[] = [
  { key: 'agentError', label: 'Agent Error', desc: 'Agent run encounters an error and stops' },
  { key: 'agentComplete', label: 'Agent Complete', desc: 'Agent run finishes successfully' },
  { key: 'agentPaused', label: 'Agent Paused', desc: 'Agent run paused (max iterations or manual)' },
  { key: 'approvalRequired', label: 'Approval Required', desc: 'Agent needs approval before proceeding' },
  { key: 'backupFailed', label: 'Backup Failed', desc: 'Automatic database backup failed' },
];

interface FieldDef {
  name: string;
  label: string;
  type: string;
  placeholder: string;
}

export default function NotificationPanel({ onClose }: Props) {
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<ChannelKey | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'sending' | 'ok' | 'error'>>({});
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/notifications/config')
      .then(r => r.json())
      .then((d: NotificationConfig) => setConfig(d))
      .catch(() => {});
  }, []);

  const save = useCallback(async (updated: NotificationConfig) => {
    setSaving(true);
    try {
      await fetch('/api/notifications/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }, []);

  const setGlobal = (enabled: boolean) => {
    if (!config) return;
    const next = { ...config, enabled };
    setConfig(next);
    save(next);
  };

  const setChannelField = (channelKey: ChannelKey, field: string, value: string | boolean | number) => {
    if (!config) return;
    const next: NotificationConfig = {
      ...config,
      channels: {
        ...config.channels,
        [channelKey]: {
          ...config.channels[channelKey],
          [field]: value,
        },
      },
    };
    setConfig(next);
    save(next);
  };

  const setEvent = (eventKey: string, value: boolean) => {
    if (!config) return;
    const next: NotificationConfig = {
      ...config,
      events: { ...config.events, [eventKey]: value },
    };
    setConfig(next);
    save(next);
  };

  const sendTest = async (channelKey: ChannelKey) => {
    setTestStatus(s => ({ ...s, [channelKey]: 'sending' }));
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channelKey }),
      });
      const data = await res.json() as { ok: boolean; message: string };
      setTestStatus(s => ({ ...s, [channelKey]: data.ok ? 'ok' : 'error' }));
      setTestMsg(m => ({ ...m, [channelKey]: data.message }));
    } catch (e) {
      setTestStatus(s => ({ ...s, [channelKey]: 'error' }));
      setTestMsg(m => ({ ...m, [channelKey]: String(e) }));
    }
    setTimeout(() => setTestStatus(s => ({ ...s, [channelKey]: 'idle' })), 5000);
  };

  if (!config) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="bg-gray-900 rounded-xl p-6 text-gray-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-700"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-white">Notification Settings</h2>
          {saving && <span className="text-xs text-gray-500">Saving…</span>}
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors text-xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Global toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Enable Notifications</p>
              <p className="text-xs text-gray-500 mt-0.5">Master switch for all notification channels</p>
            </div>
            <button
              onClick={() => setGlobal(!config.enabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.enabled ? 'bg-blue-600' : 'bg-gray-600'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${config.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Events */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Notify on Events</p>
            <div className="space-y-2">
              {EVENTS.map(ev => (
                <div key={ev.key} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-gray-800">
                  <div>
                    <p className="text-sm text-gray-200">{ev.label}</p>
                    <p className="text-xs text-gray-500">{ev.desc}</p>
                  </div>
                  <button
                    onClick={() => setEvent(ev.key, !config.events[ev.key])}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.events[ev.key] ? 'bg-blue-600' : 'bg-gray-600'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${config.events[ev.key] ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Channels */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Channels</p>
            <div className="space-y-2">
              {CHANNELS.map(ch => {
                const channelCfg = config.channels[ch.key] as unknown as { enabled: boolean; [key: string]: string | number | boolean };
                const isExpanded = expanded === ch.key;
                const ts = testStatus[ch.key] ?? 'idle';
                return (
                  <div key={ch.key} className="rounded-lg border border-gray-700 overflow-hidden">
                    {/* Channel header row */}
                    <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-800">
                      <span className="text-base">{ch.icon}</span>
                      <span className="flex-1 text-sm text-gray-200">{ch.label}</span>
                      {/* Test button */}
                      {channelCfg.enabled && (
                        <button
                          onClick={() => sendTest(ch.key)}
                          disabled={ts === 'sending'}
                          className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-50"
                        >
                          {ts === 'sending' ? 'Sending…' : ts === 'ok' ? '✓ Sent' : ts === 'error' ? '✗ Failed' : 'Test'}
                        </button>
                      )}
                      {/* Expand/collapse */}
                      <button
                        onClick={() => setExpanded(isExpanded ? null : ch.key)}
                        className="text-xs text-gray-500 hover:text-gray-300 px-1"
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>
                      {/* Enable toggle */}
                      <button
                        onClick={() => setChannelField(ch.key, 'enabled', !channelCfg.enabled)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${channelCfg.enabled ? 'bg-blue-600' : 'bg-gray-600'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${channelCfg.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                      </button>
                    </div>

                    {/* Test result */}
                    {testMsg[ch.key] && ts !== 'idle' && (
                      <div className={`px-3 py-1.5 text-xs border-t border-gray-700 ${ts === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                        {testMsg[ch.key]}
                      </div>
                    )}

                    {/* Config fields */}
                    {isExpanded && (
                      <div className="px-3 py-3 bg-gray-850 border-t border-gray-700 space-y-3" style={{ background: 'rgb(17 24 39)' }}>
                        {ch.key === 'email' && (
                          <p className="text-xs text-gray-500 italic">
                            Note: GitHub does not provide an SMTP service. Configure your own SMTP relay (Gmail, Outlook, Mailgun, etc.). Your GitHub-verified email can be used as the recipient.
                          </p>
                        )}
                        {ch.fields.map(field => (
                          <div key={field.name}>
                            <label className="block text-xs text-gray-400 mb-1">{field.label}</label>
                            <input
                              type={field.type}
                              value={String(channelCfg[field.name] ?? '')}
                              onChange={e => setChannelField(ch.key, field.name, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                              placeholder={field.placeholder}
                              className="w-full text-sm bg-gray-800 border border-gray-600 rounded px-2.5 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        ))}
                        {ch.key === 'email' && (
                          <div className="flex items-center justify-between pt-1">
                            <label className="text-xs text-gray-400">TLS/SSL (port 465)</label>
                            <button
                              onClick={() => setChannelField(ch.key, 'smtpSecure', !(channelCfg.smtpSecure as boolean))}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${channelCfg.smtpSecure ? 'bg-blue-600' : 'bg-gray-600'}`}
                            >
                              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${channelCfg.smtpSecure ? 'translate-x-4' : 'translate-x-1'}`} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

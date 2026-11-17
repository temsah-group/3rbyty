import { createHmac, timingSafeEqual } from 'node:crypto';

import { t, type Lang } from '../../common/i18n.js';
import type { Mail } from '../mail/mailer.js';
import { LOGO_CID } from '../mail/templates.js';
import type { NotificationKind } from './notification.model.js';

/** Emailed as they happen: things someone is waiting on, or should know about now. */
export const EMAIL_NOW: ReadonlySet<NotificationKind> = new Set(['PART_REQUEST', 'SHOP', 'LISTING', 'ACCOUNT']);
/** Gathered into one email a day: the rest a user would still want to hear of. */
export const EMAIL_DIGEST: readonly NotificationKind[] = ['FITS_YOUR_CAR', 'PRICE_DROP', 'REVIEW', 'PART_REQUEST'];

/** A notification as an email shows it. */
export type EmailItem = {
  kind: NotificationKind;
  title: string;
  body: string;
  partId: string | null;
  shopId: string | null;
  requestId: string | null;
};

/** The page of the site a notification opens; the same as the inbox and push. */
export function pathOf(item: EmailItem): string {
  if (item.requestId) return `/requests/${item.requestId}`;
  if (item.kind === 'LISTING') return '/account/parts';
  if (item.partId) return `/parts/${item.partId}`;
  if (item.kind === 'SHOP') return '/account/shop';
  if (item.shopId) return `/shops/${item.shopId}`;
  if (item.kind === 'ACCOUNT') return '/account';
  return '/notifications';
}

/**
 * The secret part of a user's "stop these emails" link: anyone holding the
 * link can turn emails off for that one user, and nothing else.
 */
export function emailOffSignature(secret: string, userId: string): string {
  return createHmac('sha256', secret).update(`email-off:${userId}`).digest('base64url').slice(0, 32);
}

export function emailOffValid(secret: string, userId: string, signature: string): boolean {
  const expected = Buffer.from(emailOffSignature(secret, userId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function emailOffUrl(siteUrl: string, apiPrefix: string, secret: string, userId: string): string {
  return `${siteUrl}${apiPrefix}/email-off?u=${userId}&s=${emailOffSignature(secret, userId)}`;
}

const NAVY = '#14213D';
const ORANGE = '#F77F00';
const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The frame every notification email shares: logo, [content], and the way to stop them. */
function frame(lang: Lang, content: string, siteUrl: string, offUrl: string): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  const name = t(lang, 'mail.appName');
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;font-family:Tahoma,Arial,sans-serif;">
<tr><td align="center" style="background:${NAVY};padding:20px 16px;">
<img src="cid:${LOGO_CID}" width="56" height="56" alt="${name}" style="display:block;border:0;border-radius:14px;">
</td></tr>
<tr><td style="padding:24px;color:${NAVY};font-size:15px;line-height:1.8;text-align:${align};">${content}</td></tr>
<tr><td align="center" style="border-top:1px solid #E5E7EB;padding:16px;color:#9CA3AF;font-size:12px;line-height:1.8;">
${t(lang, 'mail.notifyWhy')}<br>
<a href="${esc(`${siteUrl}/notifications/settings`)}" style="color:#6B7280;">${t(lang, 'mail.notifySettings')}</a> · <a href="${esc(offUrl)}" style="color:#6B7280;">${t(lang, 'mail.notifyOff')}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${ORANGE};color:#FFFFFF;text-decoration:none;font-weight:bold;border-radius:10px;padding:10px 22px;">${label}</a>`;

/** "One-click" unsubscribe headers, as Gmail and Yahoo ask of senders. */
const unsubscribeHeaders = (offUrl: string) => ({
  'List-Unsubscribe': `<${offUrl}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

/** One notification, as it happens. */
export function notificationEmail(lang: Lang, to: string, item: EmailItem, siteUrl: string, offUrl: string): Mail {
  const link = `${siteUrl}${pathOf(item)}`;
  const content = `<div style="font-size:18px;font-weight:bold;margin-bottom:8px;">${esc(item.title)}</div>
<div style="color:#374151;">${esc(item.body)}</div>
<div style="margin-top:20px;">${button(link, t(lang, 'mail.notifyOpen'))}</div>`;
  return {
    to,
    subject: item.title,
    text: `${item.title}\n\n${item.body}\n\n${link}\n\n${t(lang, 'mail.notifyOff')}: ${offUrl}`,
    html: frame(lang, content, siteUrl, offUrl),
    headers: unsubscribeHeaders(offUrl),
  };
}

/** How many a summary lists; the rest wait in the inbox. */
const DIGEST_SHOWN = 8;

/** Everything new since yesterday that was not emailed on its own, in one email. */
export function digestEmail(lang: Lang, to: string, items: EmailItem[], siteUrl: string, offUrl: string): Mail {
  const shown = items.slice(0, DIGEST_SHOWN);
  const more = items.length - shown.length;
  const rows = shown
    .map(
      (item) => `<tr><td style="padding:12px 0;border-bottom:1px solid #F3F4F6;">
<a href="${esc(`${siteUrl}${pathOf(item)}`)}" style="color:${NAVY};text-decoration:none;font-weight:bold;">${esc(item.title)}</a>
<div style="color:#4B5563;font-size:14px;">${esc(item.body)}</div></td></tr>`,
    )
    .join('');
  const content = `<div style="font-size:18px;font-weight:bold;margin-bottom:8px;">${t(lang, 'mail.digestTitle', [items.length])}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
${more > 0 ? `<div style="color:#6B7280;font-size:14px;margin-top:12px;">${t(lang, 'mail.digestMore', [more])}</div>` : ''}
<div style="margin-top:20px;">${button(`${siteUrl}/notifications`, t(lang, 'mail.digestOpen'))}</div>`;
  const text = [
    t(lang, 'mail.digestTitle', [items.length]),
    ...shown.map((item) => `- ${item.title}: ${item.body} ${siteUrl}${pathOf(item)}`),
    more > 0 ? t(lang, 'mail.digestMore', [more]) : '',
    `${t(lang, 'mail.notifyOff')}: ${offUrl}`,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    to,
    subject: t(lang, 'mail.digestSubject', [items.length]),
    text,
    html: frame(lang, content, siteUrl, offUrl),
    headers: unsubscribeHeaders(offUrl),
  };
}

/** The page a "stop these emails" link opens. */
export function emailOffPage(lang: Lang, siteUrl: string, done: boolean): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const title = done ? t(lang, 'mail.offDone') : t(lang, 'mail.offInvalid');
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;font-family:Tahoma,Arial,sans-serif;background:#F3F4F6;color:${NAVY};">
<div style="max-width:440px;margin:15vh auto;background:#fff;border-radius:16px;padding:28px;text-align:center;line-height:1.8;">
<div style="font-size:20px;font-weight:bold;">${esc(title)}</div>
<p style="color:#4B5563;">${done ? t(lang, 'mail.offHint') : ''}</p>
${button(`${siteUrl}/notifications/settings`, t(lang, 'mail.notifySettings'))}
</div></body></html>`;
}

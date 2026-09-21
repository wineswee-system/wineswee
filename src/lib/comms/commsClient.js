// Communications Suite — browser-side client for comms edge functions.
//
// IMAP/SMTP/CalDAV/CardDAV cannot run in the browser (Node-only TCP sockets),
// so all protocol work lives in Supabase Edge Functions. This module is the
// single place pages call into; each function maps 1:1 to an edge function.
//
// Edge functions (created in their respective phases):
//   comms-email-send   — SMTP send via connected account or shared mailbox
//   comms-email-sync   — IMAP delta sync for one account (also cron-triggered)
//   comms-account-test — verify IMAP/SMTP/CalDAV credentials before saving
//   comms-notify       — Notification Dispatcher: LINE → email → in-app
import { supabase } from '../supabase'

async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

/**
 * Send an email through a connected account or shared mailbox.
 * payload: { accountId, mailboxId?, to: [], cc?: [], bcc?: [], subject,
 *            bodyHtml, attachmentPaths?: [], inReplyToThreadId?, draftId? }
 * Returns { messageId, threadId }
 */
export function sendEmail(payload) {
  return invoke('comms-email-send', payload)
}

/** Trigger an immediate IMAP delta sync for one account. */
export function syncAccount(accountId) {
  return invoke('comms-email-sync', { accountId })
}

/**
 * Verify credentials before persisting an account.
 * payload: { provider, emailAddress, imapHost?, imapPort?, smtpHost?,
 *            smtpPort?, username?, password?, oauthCode? }
 * Credentials are encrypted server-side — never stored from the browser.
 */
export function testAccountConnection(payload) {
  return invoke('comms-account-test', payload)
}

/**
 * Route a notification through the dispatcher fallback chain.
 * payload: { employeeId, eventType, title, body, linkPath? }
 * Returns { channelUsed: 'line' | 'email' | 'in_app' }
 *
 * SECURITY: employeeId is caller-supplied and this client does no
 * authorization. The comms-notify edge function (not in this repo) MUST
 * validate server-side that the authenticated caller is allowed to target
 * that employeeId (same org + appropriate permission) — otherwise any
 * logged-in user could push notifications to arbitrary employees.
 */
export function dispatchNotification(payload) {
  return invoke('comms-notify', payload)
}

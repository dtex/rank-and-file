// Outgoing mail over SMTP. Built for Google Workspace's relay (smtp-relay.gmail.com),
// but any SMTP server works: only the settings differ.
import nodemailer from 'nodemailer'
import { APP_PATH } from './site.js'

export function createMailer(config, log = console) {
  if (!config.smtp.host) {
    if (config.production) {
      return { async send() { throw new Error('Mail is not set up. Set SMTP_HOST.') } }
    }
    // Development without SMTP: show the message in the terminal so sign-in links still work.
    return { async send(msg) { log.info(`\n[mail not sent: SMTP_HOST is not set]\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`) } }
  }
  const { host, port, user, pass } = config.smtp
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    // The relay identifies the sender by this name when it authenticates by IP address.
    name: new URL(config.baseUrl).hostname,
    auth: user ? { user, pass } : undefined,
  })
  return {
    async send({ to, subject, text, html, headers }) {
      await transport.sendMail({ from: config.mailFrom, to, subject, text, html, headers })
    },
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** The sign-in or confirm-address email. The token rides in the URL fragment, which is never sent to a server or logged. */
export function linkEmail({ baseUrl, token, purpose, minutes }) {
  const url = `${baseUrl}${APP_PATH}#magic=${token}`
  const change = purpose === 'change_email'
  const subject = change ? 'Confirm your new email address for Rank and File' : 'Your Rank and File sign-in link'
  const lead = change ? 'Confirm this address to use it for your Rank and File account:' : 'Use this link to sign in to Rank and File:'
  const tail = `The link works once and expires in ${minutes} minutes. If you did not ask for it, you can ignore this email.`
  return {
    subject,
    text: `${lead}\n\n${url}\n\n${tail}\n\nRank and File · Chess training for the rest of us\n`,
    html: `<p>${esc(lead)}</p><p><a href="${esc(url)}">${change ? 'Confirm this address' : 'Sign in to Rank and File'}</a></p><p style="color:#666">${esc(tail)}</p><p style="color:#666">Rank and File · Chess training for the rest of us</p>`,
  }
}

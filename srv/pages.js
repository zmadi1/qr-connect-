import { randomBytes } from 'node:crypto'

export function pageNonce() {
  return randomBytes(16).toString('base64url')
}

export function renderPage(html, name) {
  let body = html
  if (name === 'login.html' && process.env.NODE_ENV === 'production' && process.env.SHOW_SAMPLE_LOGIN !== '1') {
    body = body.replace(/\s*<div class="note">[\s\S]*?<\/div>/, '')
  }
  const nonce = pageNonce()
  return {
    nonce,
    html: body.replaceAll('<script>', `<script nonce="${nonce}">`),
  }
}

export function contentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ')
}

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const FILE = path.resolve('servicenow.env')

const FIELD_DEFAULTS = {
  firstName: 'first_name',
  surname: 'last_name',
  email: 'email',
  phone: 'business_phone',
  company: 'company',
  summary: 'short_description',
  details: '',
  externalId: 'external_id',
  externalSystem: 'external_system',
}

loadEnvFile()

export function serviceNowStatus() {
  return { configured: readConfig().configured }
}

export function leadRecord(lead, context, config = readConfig()) {
  const phone = [lead.countryCode, lead.phone].filter(Boolean).join(' ').trim()
  const place = context.eventName || 'General'
  const summary = `${lead.queryType}: ${lead.message}`.replace(/\s+/g, ' ').trim().slice(0, 160)
  const details = [
    lead.message,
    `Name: ${lead.firstName} ${lead.surname}`,
    `Email: ${lead.email}`,
    `Phone: ${phone}`,
    `Company: ${lead.company}`,
    `Query: ${lead.queryType}`,
    `Salesperson: ${context.salesperson || ''}`.trim(),
    `Card: ${place}`,
    `QR Connect lead: ${lead.ID}`,
  ].filter(Boolean).join('\n')
  const values = {
    firstName: lead.firstName,
    surname: lead.surname,
    email: lead.email,
    phone,
    company: lead.company,
    summary,
    details,
    externalId: lead.ID,
    externalSystem: config.externalSystem,
  }
  const record = {}
  for (const [name, field] of Object.entries(config.fields)) {
    if (!field || values[name] == null || values[name] === '') continue
    record[field] = values[name]
  }
  return record
}

export async function createServiceNowLead(record, config = readConfig(), fetchImpl = globalThis.fetch) {
  if (!config.configured) {
    throw httpError(400, 'ServiceNow is not connected yet. Copy servicenow.env.example to servicenow.env and fill in the instance URL, username, and password. On BTP, set those same names with cf set-env and restage.')
  }
  const target = config.table
    ? `${config.instanceUrl}/api/now/table/${encodeURIComponent(config.table)}`
    : `${config.instanceUrl}/api/sn_lead_mgmt_core/v1/lead`
  let response
  try {
    response = await fetchImpl(target, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
      },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    throw httpError(400, 'ServiceNow could not be reached. Check the instance URL and try again.')
  }
  const text = await response.text()
  let body = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = {} }
  if (!response.ok) {
    throw httpError(400, serviceNowMessage(body) || `ServiceNow returned ${response.status}.`)
  }
  const result = body.result || body
  const sysId = textValue(result.sys_id)
  const number = textValue(result.number)
  if (!sysId && !number) throw httpError(400, 'ServiceNow accepted the lead but did not return a record number.')
  return { sysId: sysId || '', number: number || sysId }
}

export function readConfig() {
  const instanceUrl = env('SERVICENOW_INSTANCE_URL').replace(/\/$/, '')
  const username = env('SERVICENOW_USERNAME')
  const password = env('SERVICENOW_PASSWORD')
  const table = env('SERVICENOW_TABLE')
  const fields = {}
  for (const [name, fallback] of Object.entries(FIELD_DEFAULTS)) {
    let chosen = fallback
    if (name === 'company' && table) chosen = ''
    if (name === 'details' && table) chosen = 'description'
    fields[name] = fieldName(name, chosen)
  }
  return {
    configured: Boolean(instanceUrl && username && password),
    instanceUrl,
    username,
    password,
    table,
    externalSystem: env('SERVICENOW_EXTERNAL_SYSTEM') || 'QR Connect',
    fields,
  }
}

function fieldName(name, fallback) {
  const key = `SERVICENOW_FIELD_${name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`
  if (process.env[key] == null) return fallback
  const value = String(process.env[key]).trim()
  if (!value || value.toLowerCase() === 'off') return ''
  return value
}

function textValue(value) {
  if (typeof value === 'string') return value
  if (value && typeof value.value === 'string') return value.value
  return ''
}

function serviceNowMessage(body) {
  const error = body?.error || body || {}
  const message = error.message || error.detail || body?.message
  return typeof message === 'string' ? message.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function loadEnvFile() {
  if (!existsSync(FILE)) return
  for (const line of readFileSync(FILE, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function env(name) {
  return String(process.env[name] || '').trim()
}

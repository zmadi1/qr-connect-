import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const FILE = path.resolve('successfactors.env')

const FIELD_DEFAULTS = {
  firstName: 'firstName',
  lastName: 'lastName',
  role: 'title',
  organisation: 'division',
  cellphone: 'cellPhone',
  email: 'email',
  username: 'username',
  userId: 'userId',
  manager: 'manager/userId',
}

loadEnvFile()

export function successFactorsStatus() {
  const config = readConfig()
  return { configured: config.configured }
}

export async function loadSuccessFactorsPeople() {
  const config = readConfig()
  if (!config.configured) return null
  if (!config.appPassword) {
    throw new Error('Set SUCCESSFACTORS_APP_PASSWORD in successfactors.env before connecting.')
  }
  const users = await fetchUsers(config)
  const photos = await mapPool(users, 4, (user) => fetchPhoto(config, valueAt(user, config.fields.userId)))
  return users.map((user, index) => toPerson(config, user, photos[index])).filter(Boolean)
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

function readConfig() {
  const apiUrl = env('SUCCESSFACTORS_API_URL').replace(/\/$/, '')
  const companyId = env('SUCCESSFACTORS_COMPANY_ID')
  const username = env('SUCCESSFACTORS_USERNAME')
  const password = env('SUCCESSFACTORS_PASSWORD')
  const fields = {}
  for (const [name, fallback] of Object.entries(FIELD_DEFAULTS)) {
    fields[name] = env(`SUCCESSFACTORS_FIELD_${name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`) || fallback
  }
  return {
    configured: Boolean(apiUrl && companyId && username && password),
    apiUrl,
    companyId,
    username,
    password,
    appPassword: env('SUCCESSFACTORS_APP_PASSWORD'),
    website: env('SUCCESSFACTORS_WEBSITE'),
    userFilter: env('SUCCESSFACTORS_USER_FILTER') || "status eq 't'",
    fields,
  }
}

function env(name) {
  return String(process.env[name] || '').trim()
}

async function fetchUsers(config) {
  const select = [...new Set([
    'userId', 'username', 'firstName', 'lastName', 'email', 'title', 'division', 'department', 'cellPhone', 'businessPhone', 'status',
    ...Object.values(config.fields).filter((name) => name && !name.includes('/')),
  ])]
  const url = new URL(`${config.apiUrl}/User`)
  url.searchParams.set('$format', 'json')
  url.searchParams.set('$select', select.join(','))
  url.searchParams.set('$expand', 'manager($select=userId,username)')
  url.searchParams.set('$filter', config.userFilter)
  const response = await fetch(url, { headers: headers(config) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.error?.message?.value || `SuccessFactors returned ${response.status}.`)
  }
  return body?.d?.results || []
}

async function fetchPhoto(config, userId) {
  if (!userId) return null
  const url = new URL(`${config.apiUrl}/Photo`)
  url.searchParams.set('$format', 'json')
  url.searchParams.set('$select', 'photo')
  url.searchParams.set('$top', '1')
  url.searchParams.set('$filter', `userId eq '${String(userId).replace(/'/g, "''")}' and photoType eq 1`)
  try {
    const response = await fetch(url, { headers: headers(config) })
    if (!response.ok) return null
    const body = await response.json()
    const raw = body?.d?.results?.[0]?.photo || body?.d?.photo
    if (!raw) return null
    return String(raw).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
  } catch {
    return null
  }
}

function toPerson(config, user, photo) {
  const externalId = text(valueAt(user, config.fields.userId))
  const firstName = text(valueAt(user, config.fields.firstName))
  const lastName = text(valueAt(user, config.fields.lastName))
  const username = loginName(valueAt(user, config.fields.username) || externalId)
  if (!externalId || !firstName || !lastName || !username) return null
  const managerRecord = Array.isArray(user.manager?.results) ? user.manager.results[0] : user.manager
  return {
    externalId,
    managerExternalId: text(managerRecord?.userId || valueAt(user, config.fields.manager)),
    username,
    password: config.appPassword,
    firstName,
    lastName,
    role: text(valueAt(user, config.fields.role)),
    organisation: text(valueAt(user, config.fields.organisation) || user.department),
    cellphone: text(valueAt(user, config.fields.cellphone) || user.businessPhone),
    email: text(valueAt(user, config.fields.email))?.toLowerCase() || null,
    website: config.website || null,
    photo,
    cardToken: createHash('sha256').update(`sf:${externalId}`).digest('base64url').slice(0, 22),
    active: true,
  }
}

function valueAt(record, pathName) {
  if (!record || !pathName) return null
  return pathName.split('/').reduce((value, key) => (value == null ? null : value[key]), record)
}

function loginName(value) {
  const name = text(value)?.toLowerCase()
  if (!name) return null
  return name.includes('@') ? name.slice(0, name.indexOf('@')) : name
}

function text(value) {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

function headers(config) {
  const token = Buffer.from(`${config.username}@${config.companyId}:${config.password}`).toString('base64')
  return { authorization: `Basic ${token}`, accept: 'application/json' }
}

async function mapPool(items, limit, task) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

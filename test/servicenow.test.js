import assert from 'node:assert/strict'
import test from 'node:test'

const saved = {}
for (const key of ['SERVICENOW_INSTANCE_URL', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD', 'SERVICENOW_TABLE', 'SERVICENOW_FIELD_COMPANY', 'SERVICENOW_FIELD_DETAILS']) {
  saved[key] = process.env[key]
  delete process.env[key]
}

const { leadRecord, createServiceNowLead, readConfig } = await import('../srv/servicenow.js')

const lead = {
  ID: '11111111-1111-4111-8111-111111111111',
  firstName: 'Amina',
  surname: 'Dlamini',
  email: 'amina.dlamini@example.com',
  countryCode: '+27',
  phone: '071 123 4567',
  company: 'Northwind',
  queryType: 'Product information',
  message: 'Please send the brochure.',
}

test('a lead becomes a ServiceNow lead record', () => {
  const config = readConfig()
  assert.equal(config.configured, false)
  const record = leadRecord(lead, { salesperson: 'Thabo Mokoena', eventName: 'BCX' }, {
    ...config,
    externalSystem: 'QR Connect',
    fields: {
      firstName: 'first_name',
      surname: 'last_name',
      email: 'email',
      phone: 'business_phone',
      company: 'company',
      summary: 'short_description',
      details: '',
      externalId: 'external_id',
      externalSystem: 'external_system',
    },
  })
  assert.equal(record.first_name, 'Amina')
  assert.equal(record.last_name, 'Dlamini')
  assert.equal(record.email, 'amina.dlamini@example.com')
  assert.equal(record.business_phone, '+27 071 123 4567')
  assert.equal(record.company, 'Northwind')
  assert.match(record.short_description, /Please send the brochure/)
  assert.equal(record.external_id, lead.ID)
  assert.equal(record.external_system, 'QR Connect')
  assert.equal('description' in record, false)
})

test('the Table API can carry the full message in description', () => {
  const previous = process.env.SERVICENOW_TABLE
  process.env.SERVICENOW_TABLE = 'sn_customerservice_case'
  try {
    const config = readConfig()
    assert.equal(config.fields.company, '')
    assert.equal(config.fields.details, 'description')
    const record = leadRecord(lead, { salesperson: 'Thabo Mokoena' }, config)
    assert.equal(record.description.includes('Please send the brochure.'), true)
    assert.equal(record.description.includes('Thabo Mokoena'), true)
    assert.equal('company' in record, false)
  } finally {
    if (previous == null) delete process.env.SERVICENOW_TABLE
    else process.env.SERVICENOW_TABLE = previous
  }
})

test('creating a lead posts to ServiceNow and keeps the record number', async () => {
  const config = {
    configured: true,
    instanceUrl: 'https://bcx.service-now.com',
    username: 'integration',
    password: 'secret',
    table: '',
    externalSystem: 'QR Connect',
    fields: {},
  }
  let sent
  const created = await createServiceNowLead({ first_name: 'Amina' }, config, async (url, options) => {
    sent = { url, options }
    return new Response(JSON.stringify({ result: { sys_id: 'abc', number: 'LEAD0001001' } }), { status: 201 })
  })
  assert.equal(created.number, 'LEAD0001001')
  assert.equal(created.sysId, 'abc')
  assert.equal(sent.url, 'https://bcx.service-now.com/api/sn_lead_mgmt_core/v1/lead')
  assert.match(sent.options.headers.authorization, /^Basic /)
  assert.equal(sent.options.body.includes('secret'), false)
})

test('a missing connection explains how to plug ServiceNow in', async () => {
  await assert.rejects(
    () => createServiceNowLead({}, readConfig(), async () => { throw new Error('should not call') }),
    /servicenow\.env/,
  )
})

test.after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
})

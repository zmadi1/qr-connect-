import assert from 'node:assert/strict'
import test from 'node:test'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars'

const { vcard } = await import('../srv/directory.js')

test('the saved business card carries the basic details and a JPEG photo', () => {
  const png = new PNG({ width: 2, height: 2 })
  png.data.fill(255)
  const card = vcard({
    firstName: 'Thabo',
    lastName: 'Mokoena',
    role: 'Account Executive',
    organisation: 'BCX',
    cellphone: '+27 82 555 0102',
    email: 'thabo.mokoena@bcx.co.za',
    website: 'https://www.bcx.co.za',
    photo: PNG.sync.write(png).toString('base64'),
  })
  const fields = unfold(card)
  assert.equal(fields.find((line) => line.startsWith('FN:')), 'FN:Thabo Mokoena')
  assert.equal(fields.find((line) => line.startsWith('ORG:')), 'ORG:BCX')
  assert.equal(fields.find((line) => line.startsWith('TITLE:')), 'TITLE:Account Executive')
  assert.equal(fields.find((line) => line.startsWith('TEL;')), 'TEL;TYPE=CELL:+27 82 555 0102')
  assert.equal(fields.find((line) => line.startsWith('EMAIL;')), 'EMAIL;TYPE=INTERNET:thabo.mokoena@bcx.co.za')
  assert.equal(fields.find((line) => line.startsWith('URL:')), 'URL:https://www.bcx.co.za')
  const photo = fields.find((line) => line.startsWith('PHOTO;'))
  assert.match(photo, /^PHOTO;ENCODING=b;TYPE=JPEG:/)
  const bytes = Buffer.from(photo.slice(photo.indexOf(':') + 1), 'base64')
  assert.equal(bytes[0], 0xff)
  assert.equal(bytes[1], 0xd8)
  for (const line of card.split('\r\n')) assert.equal(line.length <= 75, true)
})

test('an existing JPEG profile picture is kept', () => {
  const encoded = jpeg.encode({ data: Buffer.alloc(16, 255), width: 2, height: 2 }, 80)
  const original = Buffer.from(encoded.data).toString('base64')
  const card = unfold(vcard({
    firstName: 'Ayesha',
    lastName: 'Patel',
    role: 'Solutions Consultant',
    organisation: 'BCX',
    cellphone: '+27 82 555 0104',
    email: 'ayesha.patel@bcx.co.za',
    website: 'https://www.bcx.co.za',
    photo: original,
  }))
  const photo = card.find((line) => line.startsWith('PHOTO;'))
  assert.equal(photo, `PHOTO;ENCODING=b;TYPE=JPEG:${original}`)
})

function unfold(card) {
  const lines = []
  for (const line of card.replaceAll('\r\n', '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) lines[lines.length - 1] += line.slice(1)
    else if (line) lines.push(line)
  }
  return lines
}

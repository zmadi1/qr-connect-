namespace bcx.qr;

using { managed, cuid } from '@sap/cds/common';

entity Employees : cuid {
  firstName    : String(80) not null;
  lastName     : String(80) not null;
  role         : String(120);
  organisation : String(160);
  cellphone    : String(40);
  email        : String(320);
  website      : String(320);
  username     : String(80) not null;
  password     : String(255) not null;
  cardToken    : String(64) not null;
  photo        : LargeString;
  active       : Boolean default true;
  manager      : Association to Employees;
  displayEvent : Association to Events;
  events       : Association to many Events on events.owner = $self;
  leads        : Association to many Leads on leads.employee = $self;
}

entity Events : cuid, managed {
  name       : String(160) not null;
  startAt    : Timestamp not null;
  endAt      : Timestamp not null;
  location   : String(160);
  status     : String(20) default 'Open';
  standToken : String(64) not null;
  owner      : Association to Employees not null;
  leads      : Association to many Leads on leads.event = $self;
}

entity Leads : cuid, managed {
  source      : String(20) not null;
  event       : Association to Events;
  employee    : Association to Employees not null;
  firstName   : String(80) not null;
  surname     : String(80) not null;
  email       : String(320) not null;
  countryCode : String(8) not null;
  phone       : String(40) not null;
  company     : String(160) not null;
  queryType   : String(80) not null;
  message     : String(2000) not null;
  snowSysId   : String(32);
  snowNumber  : String(40);
  snowSentAt  : Timestamp;
}

annotate Employees with @assert.unique: { username: [username], cardToken: [cardToken] };
annotate Events with @assert.unique: { standToken: [standToken] };

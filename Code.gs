const SPREADSHEET_ID = '1pYPjdSmcSfAJMYN9_2SQPxB6NKKMFhmwmB4RW1zb0ZA';
const PROFILE_FOLDER_ID = '1l-wRHxqaqxW_6uXdKQzgdcXlJsOw0DDN';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = '12345';

const PROFILE_SHEET = 'Profiles';
const AGENT_SHEET = 'Agents';
const SESSION_SHEET = 'Sessions';
const PAYMENT_SHEET = 'Payments';

const PROFILE_HEADERS = [
  'id', 'timestamp', 'status', 'agentId', 'fullName', 'profileFor', 'gender', 'dob', 'age',
  'fatherName', 'motherName', 'weight', 'height', 'complexion', 'maritalStatus', 'firstMarriage',
  'religion', 'community', 'motherTongue', 'caste', 'gotra', 'rashi', 'education', 'occupation',
  'fatherProfession', 'motherProfession', 'income', 'homeType', 'childOrder',
  'brothersCount', 'sistersCount', 'lifeWish', 'addressLine', 'villageTown', 'postOffice', 'policestation',
  'district', 'state', 'pin', 'email', 'phone', 'diet', 'prefComplexion', 'prefEducationLevel',
  'prefAgeRange', 'prefHeight', 'prefLivelihood', 'prefIncomeType', 'about', 'photo', 'documentType', 'document'
];

const AGENT_HEADERS = [
  'id', 'timestamp', 'status', 'name', 'phone', 'email', 'area', 'password', 'passwordHash'
];

const SESSION_HEADERS = [
  'token', 'timestamp', 'role', 'name', 'agentId'
];

const PAYMENT_HEADERS = [
  'paymentId', 'timestamp', 'profileId', 'clientName', 'agentId', 'transactionType', 'amount', 'paymentDate', 'mode', 'purpose', 'receivedByRole', 'receivedByName', 'note', 'status', 'balanceAfter'
];

function doGet(e) {
  try {
    const view = (e && e.parameter && e.parameter.view) || 'public';
    setupSheets_();
    if (view === 'setup') {
      return json_({ ok: true, message: 'Sheets are ready', tabs: [PROFILE_SHEET, AGENT_SHEET, SESSION_SHEET, PAYMENT_SHEET] });
    }

    const profiles = readSheet_(PROFILE_SHEET, PROFILE_HEADERS);
    const agents = readSheet_(AGENT_SHEET, AGENT_HEADERS).map(safeAgent_);

    if (view === 'public') {
      return json_({
        ok: true,
        profiles: profiles.filter(profile => profile.status === 'verified'),
        agents: agents.filter(agent => agent.status === 'active')
      });
    }

    return json_({ ok: true, profiles: profiles, agents: agents });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const data = parsePostData_(e);
    const action = data.action || 'createProfile';

    if (action === 'login') return login_(data);
    if (action === 'dashboard') return dashboard_(data);
    if (action === 'createProfile') return createProfile_(data);
    if (action === 'editProfile') return editProfile_(data);
    if (action === 'setProfileStatus') return setProfileStatus_(data);
    if (action === 'deleteProfile') return deleteProfile_(data);
    if (action === 'saveAgent') return saveAgent_(data);
    if (action === 'deleteAgent') return deleteAgent_(data);
    if (action === 'savePayment') return savePayment_(data);

    return json_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

function login_(data) {
  const role = data.role === 'admin' ? 'admin' : 'agent';
  const username = String(data.username || '').trim();
  const password = String(data.password || '');

  if (role === 'admin') {
    if ((username === ADMIN_USERNAME || username === 'admin@bandhan.local') && password === ADMIN_PASSWORD) {
      const session = createSession_({ role: 'admin', name: 'Admin', agentId: '' });
      return json_({ ok: true, session: session });
    }
    return json_({ ok: false, error: 'Invalid admin login' });
  }

  const agents = readSheet_(AGENT_SHEET, AGENT_HEADERS);
  const passwordHash = hash_(password);
  const agent = agents.find(item => {
    const userMatch = String(item.phone || '').trim() === username || String(item.email || '').trim().toLowerCase() === username.toLowerCase();
    return userMatch && item.passwordHash === passwordHash && item.status === 'active';
  });

  if (!agent) {
    return json_({ ok: false, error: 'Invalid or blocked agent login' });
  }

  const session = createSession_({ role: 'agent', name: agent.name, agentId: agent.id });
  return json_({ ok: true, session: session });
}

function dashboard_(data) {
  const session = requireSession_(data.token);
  let profiles = readSheet_(PROFILE_SHEET, PROFILE_HEADERS);
  let payments = readSheet_(PAYMENT_SHEET, PAYMENT_HEADERS);
  const agents = readSheet_(AGENT_SHEET, AGENT_HEADERS).map(safeAgent_);

  if (session.role === 'agent') {
    profiles = profiles.filter(profile => canAgentManageProfile_(session, profile));
    const allowedIds = profiles.map(profile => String(profile.id || ''));
    payments = payments.filter(payment => allowedIds.includes(String(payment.profileId || '')) || String(payment.agentId || '') === String(session.agentId || ''));
  }

  return json_({ ok: true, profiles: profiles, agents: session.role === 'admin' ? agents : [], payments: payments });
}

function createProfile_(data) {
  const profileSheet = getSheet_(PROFILE_SHEET, PROFILE_HEADERS);
  const session = data.token ? requireSession_(data.token) : null;
  const profile = normalizeProfile_(data);

  if (session && session.role === 'agent') {
    profile.agentId = session.agentId;
  }

  if (session && session.role === 'admin' && data.agentId) {
    profile.agentId = data.agentId;
  }

  appendObject_(profileSheet, PROFILE_HEADERS, profile);
  return json_({ ok: true, id: profile.id, photo: profile.photo });
}

function editProfile_(data) {
  const session = requireSession_(data.token);
  const sheet = getSheet_(PROFILE_SHEET, PROFILE_HEADERS);
  const existing = findById_(sheet, data.id);

  if (session.role === 'agent' && !canAgentManageProfile_(session, existing.item)) {
    throw new Error('Agent can edit only assigned or public client data');
  }

  const updates = normalizeProfile_(Object.assign({}, existing.item, data));
  updates.id = existing.item.id;
  updates.timestamp = existing.item.timestamp || new Date();
  if (session.role === 'agent') updates.agentId = session.agentId;
  updateRow_(sheet, existing.row, PROFILE_HEADERS, updates);
  return json_({ ok: true });
}

function setProfileStatus_(data) {
  const session = requireSession_(data.token);
  const sheet = getSheet_(PROFILE_SHEET, PROFILE_HEADERS);
  const found = findById_(sheet, data.id);
  if (session.role === 'agent' && !canAgentManageProfile_(session, found.item)) {
    throw new Error('Agent can approve only assigned or public client data');
  }
  if (session.role !== 'admin' && session.role !== 'agent') throw new Error('Login required');
  setCellByHeader_(sheet, found.row, PROFILE_HEADERS, 'status', data.status || 'pending');
  return json_({ ok: true });
}

function deleteProfile_(data) {
  const session = requireSession_(data.token);
  const sheet = getSheet_(PROFILE_SHEET, PROFILE_HEADERS);
  const found = findById_(sheet, data.id);

  if (session.role !== 'admin') {
    throw new Error('Only admin can delete client profiles');
  }

  sheet.deleteRow(found.row);
  return json_({ ok: true });
}

function saveAgent_(data) {
  const session = requireSession_(data.token);
  if (session.role !== 'admin') throw new Error('Only admin can manage agents');

  const sheet = getSheet_(AGENT_SHEET, AGENT_HEADERS);
  const existingById = data.id ? tryFindById_(sheet, data.id) : null;
  const existingByContact = findAgentByContact_(sheet, data.phone, data.email);
  const matched = existingById || existingByContact;

  if (existingById && existingByContact && existingById.item.id !== existingByContact.item.id) {
    throw new Error('Phone or email is already used by another agent');
  }

  const agent = {};
  AGENT_HEADERS.forEach(header => agent[header] = data[header] || '');
  if (matched) {
    agent.id = matched.item.id;
    agent.timestamp = matched.item.timestamp || new Date();
  } else {
    agent.id = agent.id || ('AG' + Date.now().toString().slice(-8));
    agent.timestamp = agent.timestamp || new Date();
  }
  agent.status = agent.status || 'active';

  if (data.password) {
    agent.password = data.password;
    agent.passwordHash = hash_(data.password);
  } else if (matched) {
    agent.password = matched.item.password || '';
    agent.passwordHash = matched.item.passwordHash || '';
  }

  if (!agent.passwordHash) throw new Error('Password is required for new agent');

  if (matched) {
    updateRow_(sheet, matched.row, AGENT_HEADERS, agent);
  } else {
    appendObject_(sheet, AGENT_HEADERS, agent);
  }

  return json_({ ok: true, agent: safeAgent_(agent) });
}

function deleteAgent_(data) {
  const session = requireSession_(data.token);
  if (session.role !== 'admin') throw new Error('Only admin can delete agents');
  const sheet = getSheet_(AGENT_SHEET, AGENT_HEADERS);
  const found = findById_(sheet, data.id);
  sheet.deleteRow(found.row);
  return json_({ ok: true });
}

function savePayment_(data) {
  const session = requireSession_(data.token);
  if (session.role !== 'admin' && session.role !== 'agent') throw new Error('Login required');

  const profileSheet = getSheet_(PROFILE_SHEET, PROFILE_HEADERS);
  const found = findById_(profileSheet, data.profileId);
  if (session.role === 'agent' && !canAgentManageProfile_(session, found.item)) {
    throw new Error('Agent can add payment only for assigned or public client data');
  }

  const amount = Number(data.amount || 0);
  if (!amount || amount <= 0) throw new Error('Valid payment amount is required');

  const transactionType = String(data.transactionType || 'credit').toLowerCase() === 'debit' ? 'debit' : 'credit';
  const signedAmount = transactionType === 'debit' ? -amount : amount;
  const previousBalance = paymentBalanceForProfile_(found.item.id);

  const payment = {};
  PAYMENT_HEADERS.forEach(header => payment[header] = data[header] || '');
  payment.paymentId = payment.paymentId || ('PAY' + Date.now().toString().slice(-9));
  payment.timestamp = new Date();
  payment.profileId = found.item.id;
  payment.clientName = found.item.fullName || data.clientName || '';
  payment.agentId = found.item.agentId || session.agentId || data.agentId || '';
  payment.transactionType = transactionType;
  payment.amount = amount;
  payment.paymentDate = data.paymentDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  payment.mode = data.mode || 'Cash';
  payment.purpose = data.purpose || (transactionType === 'debit' ? 'Service / Refund Debit' : 'Registration Fee');
  payment.receivedByRole = session.role;
  payment.receivedByName = session.name || session.role;
  payment.status = transactionType === 'debit' ? 'debited' : 'received';
  payment.balanceAfter = previousBalance + signedAmount;

  const sheet = getSheet_(PAYMENT_SHEET, PAYMENT_HEADERS);
  appendObject_(sheet, PAYMENT_HEADERS, payment);
  return json_({ ok: true, payment: payment });
}

function paymentBalanceForProfile_(profileId) {
  const payments = readSheet_(PAYMENT_SHEET, PAYMENT_HEADERS)
    .filter(payment => String(payment.profileId || '') === String(profileId || ''));
  return payments.reduce((sum, payment) => {
    const type = String(payment.transactionType || '').toLowerCase();
    const status = String(payment.status || '').toLowerCase();
    const isDebit = type === 'debit' || status === 'debited' || status === 'refund' || status === 'service';
    const amount = Number(payment.amount || 0);
    return sum + (isDebit ? -amount : amount);
  }, 0);
}
function normalizeProfile_(data) {
  const profile = {};
  PROFILE_HEADERS.forEach(header => profile[header] = data[header] || '');

  profile.id = profile.id || ('BND' + Date.now().toString().slice(-8));
  profile.timestamp = profile.timestamp || new Date();
  profile.status = profile.status || 'pending';
  profile.age = profile.age || calculateAge_(profile.dob);

  if (data.photo && String(data.photo).startsWith('data:image/')) {
    profile.photo = saveProfileFile_(data.photo, profile.id, profile.fullName, 'photo');
  }

  if (data.document && String(data.document).startsWith('data:')) {
    profile.document = saveProfileFile_(data.document, profile.id, profile.fullName, profile.documentType || 'document');
  }

  return profile;
}

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet && name === PROFILE_SHEET) {
    const firstSheet = ss.getSheets()[0];
    const firstHeaders = firstSheet.getRange(1, 1, 1, Math.max(firstSheet.getLastColumn(), 1)).getValues()[0].map(String);
    const looksLikeProfileSheet = firstHeaders.includes('id') && firstHeaders.includes('fullName');
    if (looksLikeProfileSheet) {
      firstSheet.setName(PROFILE_SHEET);
      sheet = firstSheet;
    }
    if (!sheet && firstSheet.getLastRow() === 0 && firstSheet.getLastColumn() === 0) {
      firstSheet.setName(PROFILE_SHEET);
      sheet = firstSheet;
    }
    if (!sheet && firstSheet.getLastRow() <= 1 && firstSheet.getLastColumn() <= 1) {
      const onlyCell = firstSheet.getRange(1, 1).getValue();
      if (!onlyCell) {
        firstSheet.setName(PROFILE_SHEET);
        sheet = firstSheet;
      }
    }
  }
  if (!sheet) sheet = ss.insertSheet(name);

  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const currentHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);

  if (currentHeaders.filter(String).length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    const missing = headers.filter(header => !currentHeaders.includes(header));
    if (missing.length) {
      sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
    }
  }

  return sheet;
}

function setupSheets_() {
  getSheet_(PROFILE_SHEET, PROFILE_HEADERS);
  getSheet_(AGENT_SHEET, AGENT_HEADERS);
  getSheet_(SESSION_SHEET, SESSION_HEADERS);
  getSheet_(PAYMENT_SHEET, PAYMENT_HEADERS);
}

function setupSheets() {
  setupSheets_();
  return 'Profiles, Agents, Sessions, Payments tabs are ready.';
}

function readSheet_(name, headers) {
  const sheet = getSheet_(name, headers);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const sheetHeaders = values[0].map(String);
  return values.slice(1)
    .filter(row => row.some(cell => String(cell || '').trim() !== ''))
    .map(row => rowToObject_(sheetHeaders, row))
    .filter(item => isMeaningfulRow_(name, item));
}

function rowToObject_(headers, row) {
  const item = {};
  headers.forEach((header, index) => {
    const value = row[index];
    item[header] = value instanceof Date
      ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : value;
  });
  return item;
}

function isMeaningfulRow_(sheetName, item) {
  if (sheetName === PROFILE_SHEET) {
    return Boolean(String(item.id || '').trim() || String(item.fullName || '').trim() || String(item.phone || '').trim());
  }
  if (sheetName === AGENT_SHEET) {
    return Boolean(String(item.id || '').trim() || String(item.name || '').trim() || String(item.phone || '').trim() || String(item.email || '').trim());
  }
  if (sheetName === SESSION_SHEET) {
    return Boolean(String(item.token || '').trim());
  }
  if (sheetName === PAYMENT_SHEET) {
    return Boolean(String(item.paymentId || '').trim() || String(item.profileId || '').trim() || String(item.amount || '').trim());
  }
  return Object.keys(item).some(key => String(item[key] || '').trim() !== '');
}

function appendObject_(sheet, headers, item) {
  const sheetHeaders = getHeaders_(sheet, headers);
  sheet.appendRow(sheetHeaders.map(header => item[header] || ''));
}

function updateRow_(sheet, row, headers, item) {
  const sheetHeaders = getHeaders_(sheet, headers);
  sheet.getRange(row, 1, 1, sheetHeaders.length).setValues([sheetHeaders.map(header => item[header] || '')]);
}

function findById_(sheet, id) {
  if (!id) throw new Error('Missing id');
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idColumn = headers.indexOf('id');
  if (idColumn === -1) throw new Error('Missing id column');

  for (let index = 1; index < values.length; index++) {
    if (String(values[index][idColumn]) === String(id)) {
      return { row: index + 1, item: rowToObject_(headers, values[index]) };
    }
  }

  throw new Error('Not found: ' + id);
}

function tryFindById_(sheet, id) {
  try {
    return findById_(sheet, id);
  } catch (err) {
    return null;
  }
}

function findAgentByContact_(sheet, phone, email) {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanPhone && !cleanEmail) return null;

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  const headers = values[0].map(String);
  const phoneColumn = headers.indexOf('phone');
  const emailColumn = headers.indexOf('email');

  for (let index = 1; index < values.length; index++) {
    const rowPhone = phoneColumn === -1 ? '' : String(values[index][phoneColumn] || '').replace(/\D/g, '');
    const rowEmail = emailColumn === -1 ? '' : String(values[index][emailColumn] || '').trim().toLowerCase();
    if ((cleanPhone && rowPhone === cleanPhone) || (cleanEmail && rowEmail === cleanEmail)) {
      return { row: index + 1, item: rowToObject_(headers, values[index]) };
    }
  }

  return null;
}

function canAgentManageProfile_(session, profile) {
  const profileAgentId = String(profile.agentId || '').trim();
  return !profileAgentId || profileAgentId === String(session.agentId || '').trim();
}

function setCellByHeader_(sheet, row, headers, header, value) {
  const sheetHeaders = getHeaders_(sheet, headers);
  const column = sheetHeaders.indexOf(header);
  if (column === -1) throw new Error('Missing header: ' + header);
  sheet.getRange(row, column + 1).setValue(value);
}

function getHeaders_(sheet, requiredHeaders) {
  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
  const missing = requiredHeaders.filter(header => !currentHeaders.includes(header));
  if (missing.length) {
    sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
    return currentHeaders.concat(missing);
  }
  return currentHeaders;
}

function createSession_(session) {
  const token = Utilities.getUuid();
  const sheet = getSheet_(SESSION_SHEET, SESSION_HEADERS);
  const payload = {
    token: token,
    timestamp: new Date(),
    role: session.role,
    name: session.name,
    agentId: session.agentId || ''
  };
  appendObject_(sheet, SESSION_HEADERS, payload);
  return payload;
}

function requireSession_(token) {
  if (!token) throw new Error('Login required');
  const sessions = readSheet_(SESSION_SHEET, SESSION_HEADERS);
  const session = sessions.reverse().find(item => item.token === token);
  if (!session) throw new Error('Session expired. Please login again.');
  return session;
}

function safeAgent_(agent) {
  return {
    id: agent.id || '',
    timestamp: agent.timestamp || '',
    status: agent.status || 'active',
    name: agent.name || '',
    phone: agent.phone || '',
    email: agent.email || '',
    area: agent.area || '',
    password: agent.password || ''
  };
}

function saveProfileFile_(dataUrl, id, fullName, type) {
  const match = String(dataUrl).match(/^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return '';

  const mimeType = match[1];
  const extension = extensionFromMimeType_(mimeType);
  const label = String(type || 'file').replace(/[^\w-]+/g, '_').slice(0, 24) || 'file';
  const safeName = String(fullName || id || 'profile').replace(/[^\w-]+/g, '_').slice(0, 40);
  const blob = Utilities.newBlob(
    Utilities.base64Decode(match[2]),
    mimeType,
    `${id}_${label}_${safeName}.${extension}`
  );

  const folder = getProfileFolder_(id, fullName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  if (mimeType.indexOf('image/') === 0 && label.toLowerCase() === 'photo') {
    return `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w1000`;
  }
  return file.getUrl();
}

function getProfileFolder_(id, fullName) {
  const parent = DriveApp.getFolderById(PROFILE_FOLDER_ID);
  const safeName = String(fullName || 'Client').replace(/[^\w-]+/g, '_').slice(0, 40) || 'Client';
  const folderName = `${id}_${safeName}`;
  const existing = parent.getFoldersByName(folderName);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(folderName);
}

function extensionFromMimeType_(mimeType) {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return mimeType.split('/').pop().replace('jpeg', 'jpg').replace(/[^a-zA-Z0-9]/g, '') || 'file';
}

function calculateAge_(dob) {
  if (!dob) return '';
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return '';

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function hash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value));
  return bytes.map(byte => {
    const unsigned = byte < 0 ? byte + 256 : byte;
    return ('0' + unsigned.toString(16)).slice(-2);
  }).join('');
}

function parsePostData_(e) {
  const body = (e && e.postData && e.postData.contents) || '{}';
  try {
    return JSON.parse(body);
  } catch (err) {
    const data = {};
    body.split('&').forEach(pair => {
      const parts = pair.split('=');
      if (parts[0]) {
        data[decodeURIComponent(parts[0])] = decodeURIComponent((parts[1] || '').replace(/\+/g, ' '));
      }
    });
    return data;
  }
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}





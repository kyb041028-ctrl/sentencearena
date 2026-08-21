'use strict';

const crypto = require('crypto');

function readPepper(explicit) {
  const fromArg = String(explicit || '').trim();
  if (fromArg) return fromArg;
  return String(process.env.RETENTION_IDENTITY_PEPPER || '').trim();
}

function hmacIdentity(pepper, kind, value) {
  const p = String(pepper || '').trim();
  const v = String(value || '').trim().toLowerCase();
  const k = String(kind || 'UID').trim().toUpperCase();
  if (!p || !v) return null;
  return crypto.createHmac('sha256', p).update(k + ':' + v, 'utf8').digest('hex');
}

function identitiesFromAuthUser(user) {
  const u = user || {};
  const out = [];
  if (u.id) out.push({ kind: 'UID', value: String(u.id) });
  if (u.email) out.push({ kind: 'EMAIL', value: String(u.email).trim().toLowerCase() });
  const identities = Array.isArray(u.identities) ? u.identities : [];
  for (let i = 0; i < identities.length; i++) {
    const row = identities[i] || {};
    const provider = String(row.provider || '').trim().toLowerCase();
    const sub = String(row.identity_id || row.id || (row.identity_data && row.identity_data.sub) || '').trim();
    if (provider && sub) out.push({ kind: 'OAUTH_' + provider.toUpperCase(), value: provider + ':' + sub });
  }
  return out;
}

function hashIdentities(pepper, user) {
  const p = readPepper(pepper);
  if (!p) return { ok: false, error: 'RETENTION_PEPPER_MISSING', hashes: [] };
  const src = identitiesFromAuthUser(user);
  const hashes = [];
  const seen = {};
  for (let i = 0; i < src.length; i++) {
    const hex = hmacIdentity(p, src[i].kind, src[i].value);
    if (!hex || seen[hex]) continue;
    seen[hex] = true;
    hashes.push({ identityKind: src[i].kind, identityHash: hex });
  }
  return { ok: true, hashes: hashes };
}

module.exports = {
  readPepper,
  hmacIdentity,
  identitiesFromAuthUser,
  hashIdentities,
};

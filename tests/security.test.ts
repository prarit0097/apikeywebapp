import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, isPublicAddress, validatePublicUrl, hashPassword, verifyPassword } from '../server/security.js';

test('encrypted provider secrets cannot be read without the correct key and detect tampering', () => {
  const key = randomBytes(32), secret = 'sk-private-provider-secret';
  const encrypted = encryptSecret(secret, key);
  assert.ok(!encrypted.includes(secret));
  assert.equal(decryptSecret(encrypted, key), secret);
  assert.throws(() => decryptSecret(encrypted, randomBytes(32)));
  const parts = encrypted.split('.'); parts[2] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptSecret(parts.join('.'), key));
});

test('upstream connections reject all local, metadata, mapped and special-use IP ranges', () => {
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.2','0.0.0.0','::1','fc00::1','fe80::1','::ffff:127.0.0.1','100.64.0.1','192.0.2.1','2001:db8::1']) assert.equal(isPublicAddress(ip),false,ip);
  assert.equal(isPublicAddress('8.8.8.8'),true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
});

test('upstream URL validation rejects credentials, plaintext and DNS resolving to private IPs', async () => {
  for (const url of ['http://api.example.com','https://user:pass@example.com','https://localhost','https://127.0.0.1','https://[::1]']) await assert.rejects(validatePublicUrl(url));
  await assert.rejects(validatePublicUrl('https://example.com', async()=>[{address:'127.0.0.1',family:4}]));
  await assert.rejects(validatePublicUrl('https://example.com', async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]));
});

test('password hash is salted and wrong passwords do not authenticate', async () => {
  const a=await hashPassword('a strong password 123'), b=await hashPassword('a strong password 123');
  assert.notEqual(a,b); assert.ok(await verifyPassword('a strong password 123',a)); assert.ok(!await verifyPassword('incorrect',a));
});

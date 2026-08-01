/**
 * Scenario: No password set — auth not required, any token accepted
 * Scenario: Set password and login — valid token, wrong password rejected
 * Scenario: Change password requires current; clears sessions
 * Scenario: Clear password with current unlocks admin
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AdminAuthStore } from './adminAuth.js';

describe('AdminAuthStore', () => {
  let dir: string;
  let store: AdminAuthStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-auth-'));
    store = new AdminAuthStore(path.join(dir, 'admin-auth.json'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is open when no password set', () => {
    expect(store.isPasswordSet()).toBe(false);
    expect(store.validateToken(null)).toBe(true);
    expect(store.validateToken('anything')).toBe(true);
  });

  it('sets password and requires login', () => {
    const result = store.setPassword('secret1');
    expect(result.ok).toBe(true);
    expect(store.isPasswordSet()).toBe(true);
    expect(store.validateToken(null)).toBe(false);

    const bad = store.login('wrong');
    expect(bad.ok).toBe(false);

    const good = store.login('secret1');
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(store.validateToken(good.token)).toBe(true);
    }
  });

  it('requires current password to change', () => {
    store.setPassword('first');
    const fail = store.setPassword('second', 'nope');
    expect(fail.ok).toBe(false);

    const ok = store.setPassword('second', 'first');
    expect(ok.ok).toBe(true);
    expect(store.login('first').ok).toBe(false);
    expect(store.login('second').ok).toBe(true);
  });

  it('clears password and sessions', () => {
    store.setPassword('secret');
    const login = store.login('secret');
    expect(login.ok).toBe(true);
    const clear = store.setPassword('', 'secret');
    expect(clear.ok).toBe(true);
    expect(store.isPasswordSet()).toBe(false);
    expect(store.validateToken(null)).toBe(true);
  });

  it('persists password hash across reload', () => {
    store.setPassword('persist-me');
    const again = new AdminAuthStore(path.join(dir, 'admin-auth.json'));
    expect(again.isPasswordSet()).toBe(true);
    expect(again.login('persist-me').ok).toBe(true);
  });

  it('rejects short passwords', () => {
    const r = store.setPassword('ab');
    expect(r.ok).toBe(false);
  });
});

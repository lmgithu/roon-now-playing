import fs from 'fs';
import path from 'path';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

const DATA_DIR = process.env.DATA_DIR || './config';
const DEFAULT_PATH = path.join(DATA_DIR, 'admin-auth.json');

/** Session lifetime (7 days) */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredAuth {
  /** scrypt hash hex */
  passwordHash: string;
  /** salt hex */
  salt: string;
}

interface Session {
  token: string;
  expiresAt: number;
}

export class AdminAuthStore {
  private configPath: string;
  private stored: StoredAuth | null = null;
  private sessions = new Map<string, Session>();

  constructor(configPath: string = DEFAULT_PATH) {
    this.configPath = configPath;
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as Partial<StoredAuth>;
        if (data.passwordHash && data.salt) {
          this.stored = { passwordHash: data.passwordHash, salt: data.salt };
          logger.info(`Loaded admin auth from ${this.configPath}`);
        }
      }
    } catch (error) {
      logger.error(`Failed to load admin auth: ${error}`);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!this.stored) {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
        return;
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.stored, null, 2));
    } catch (error) {
      logger.error(`Failed to save admin auth: ${error}`);
    }
  }

  isPasswordSet(): boolean {
    return this.stored !== null;
  }

  private hashPassword(password: string, salt: Buffer): Buffer {
    return scryptSync(password, salt, 64);
  }

  private verifyPassword(password: string): boolean {
    if (!this.stored) return false;
    try {
      const salt = Buffer.from(this.stored.salt, 'hex');
      const expected = Buffer.from(this.stored.passwordHash, 'hex');
      const actual = this.hashPassword(password, salt);
      if (expected.length !== actual.length) return false;
      return timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  /**
   * Set or change password. If a password already exists, currentPassword is required.
   * Pass empty newPassword to clear protection (requires currentPassword).
   */
  setPassword(newPassword: string, currentPassword?: string): { ok: true } | { ok: false; error: string } {
    if (this.stored) {
      if (!currentPassword || !this.verifyPassword(currentPassword)) {
        return { ok: false, error: 'Current password is incorrect' };
      }
    }

    if (!newPassword) {
      // Clear password
      this.stored = null;
      this.sessions.clear();
      this.save();
      logger.info('Admin password cleared');
      return { ok: true };
    }

    if (newPassword.length < 4) {
      return { ok: false, error: 'Password must be at least 4 characters' };
    }
    if (newPassword.length > 200) {
      return { ok: false, error: 'Password is too long' };
    }

    const salt = randomBytes(16);
    const hash = this.hashPassword(newPassword, salt);
    this.stored = {
      passwordHash: hash.toString('hex'),
      salt: salt.toString('hex'),
    };
    // Invalidate existing sessions on password change
    this.sessions.clear();
    this.save();
    logger.info('Admin password set/updated');
    return { ok: true };
  }

  login(password: string): { ok: true; token: string } | { ok: false; error: string } {
    if (!this.stored) {
      // No password — treat as open admin
      return { ok: false, error: 'Password protection is not enabled' };
    }
    if (!this.verifyPassword(password)) {
      return { ok: false, error: 'Invalid password' };
    }
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, {
      token,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    this.pruneSessions();
    return { ok: true, token };
  }

  logout(token: string | null | undefined): void {
    if (token) this.sessions.delete(token);
  }

  validateToken(token: string | null | undefined): boolean {
    if (!this.stored) return true; // no password = open
    if (!token) return false;
    const session = this.sessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    // Sliding expiry
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return true;
  }

  private pruneSessions(): void {
    const now = Date.now();
    for (const [t, s] of this.sessions) {
      if (now > s.expiresAt) this.sessions.delete(t);
    }
  }

  extractToken(req: Request): string | null {
    const auth = req.headers.authorization;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim() || null;
    }
    const header = req.headers['x-admin-token'];
    if (typeof header === 'string' && header) return header;
    return null;
  }

  /** Express middleware: require valid admin session when password is set. */
  requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (!this.isPasswordSet()) {
      next();
      return;
    }
    const token = this.extractToken(req);
    if (!this.validateToken(token)) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Admin password required',
        authRequired: true,
      });
      return;
    }
    next();
  };
}

/** Singleton used by routers and WebSocket */
let sharedStore: AdminAuthStore | null = null;

export function getAdminAuthStore(): AdminAuthStore {
  if (!sharedStore) {
    sharedStore = new AdminAuthStore();
  }
  return sharedStore;
}

/** Test helper */
export function resetAdminAuthStoreForTests(store?: AdminAuthStore): void {
  sharedStore = store ?? null;
}

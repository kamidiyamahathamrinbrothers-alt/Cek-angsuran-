import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthUser, UserRole } from '../src/types';
import { db } from './db';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  authToken?: string;
}

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function createSessionForUser(userId: number): { token: string; expires_at: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS).toISOString();
  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(token, userId, expiresAt, now.toISOString());
  return { token, expires_at: expiresAt };
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getUserByToken(token: string): AuthUser | null {
  if (!token) return null;
  const row = db
    .prepare(`
      SELECT u.id, u.name, u.username, u.role, u.is_active, u.created_at, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `)
    .get(token) as
    | {
        id: number;
        name: string;
        username: string;
        role: UserRole;
        is_active: number;
        created_at: string;
        expires_at: string;
      }
    | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now() || row.is_active !== 1) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    is_active: row.is_active === 1,
    created_at: row.created_at,
  };
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

export function attachOptionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (token) {
    const user = getUserByToken(token);
    if (user) {
      req.user = user;
      req.authToken = token;
    }
  }
  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Autentikasi diperlukan. Silakan login terlebih dahulu.' });
    return;
  }
  const user = getUserByToken(token);
  if (!user) {
    res.status(401).json({ error: 'Sesi login telah berakhir atau tidak valid. Silakan login kembali.' });
    return;
  }
  req.user = user;
  req.authToken = token;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Autentikasi diperlukan.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Akses ditolak. Akun Anda tidak memiliki izin untuk mengubah data ini.',
      });
      return;
    }
    next();
  };
}

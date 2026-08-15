// netlify/functions/_staff-auth.ts
//
// staff-login.ts が発行したトークンを検証する共通ヘルパー。

import type { HandlerEvent } from '@netlify/functions';
import jwt from 'jsonwebtoken';

export interface StaffTokenPayload {
  staff_id: string;
  store_id: string;
}

export function verifyStaffToken(event: HandlerEvent): StaffTokenPayload | null {
  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.STAFF_SESSION_SECRET!) as StaffTokenPayload;
  } catch {
    return null;
  }
}

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback);
const PASSWORD_HISTORY_LIMIT = 3;

export interface PasswordHistoryEntry {
  hash: string;
  salt: string;
  createdAt: string;
}

export async function hashPasswordForHistory(
  password: string,
): Promise<PasswordHistoryEntry> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return {
    hash: derivedKey.toString("hex"),
    salt,
    createdAt: new Date().toISOString(),
  };
}

export async function doesPasswordMatchHistory(
  password: string,
  history: PasswordHistoryEntry[] = [],
): Promise<boolean> {
  for (const entry of history) {
    if (!entry?.salt || !entry?.hash) continue;
    const derivedKey = (await scrypt(password, entry.salt, 64)) as Buffer;
    const storedHash = Buffer.from(entry.hash, "hex");
    if (
      storedHash.length === derivedKey.length &&
      timingSafeEqual(storedHash, derivedKey)
    ) {
      return true;
    }
  }

  return false;
}

export async function appendPasswordHistory(
  password: string,
  history: PasswordHistoryEntry[] = [],
): Promise<PasswordHistoryEntry[]> {
  if (await doesPasswordMatchHistory(password, history)) {
    return history.slice(-PASSWORD_HISTORY_LIMIT);
  }

  const nextEntry = await hashPasswordForHistory(password);
  return [...history, nextEntry].slice(-PASSWORD_HISTORY_LIMIT);
}

export function getPasswordHistoryLimit(): number {
  return PASSWORD_HISTORY_LIMIT;
}

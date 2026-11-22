import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** OWASP-recommended Argon2id baseline: m=19 MiB, t=2, p=1. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

@Injectable()
export class PasswordService {
  /** Pre-computed hash used to equalize timing when the user does not exist. */
  private dummyHash: Promise<string> = hashPassword('dummy-password-for-timing-1');

  hash(plain: string): Promise<string> {
    return hashPassword(plain);
  }

  async verify(hash: string | null | undefined, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash ?? (await this.dummyHash), plain);
    } catch {
      return false;
    }
  }
}

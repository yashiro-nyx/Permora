import argon2 from "argon2";

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export function hashPassword(password: string) {
  return argon2.hash(password, OPTIONS);
}

export function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

import bcrypt from "bcryptjs";

const COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

// A real hash used when no user matches, so failed lookups take as long as real comparisons
// (prevents account enumeration via response timing). Generated once per process.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    dummyHash ??= bcrypt.hash("roavela-timing-equaliser", COST);
    await bcrypt.compare(password, await dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}

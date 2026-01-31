import bcrypt from "bcrypt";

export function generatePassword() {
  return Math.random().toString(36).slice(-8);
}

export async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

export async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

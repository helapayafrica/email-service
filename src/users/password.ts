import { hash, verify } from '@node-rs/argon2';
export function hashPassword(password:string):
Promise<string> {
  return hash(password);
}

export function verifyPassword(
  passwordHash:string,
    password:string
  ){
  return verify(passwordHash, password);
  }
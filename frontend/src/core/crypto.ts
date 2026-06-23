import CryptoJS from 'crypto-js';

export function encryptMessage(message: string, key: string): string {
  return CryptoJS.AES.encrypt(message, key).toString();
}

export function decryptMessage(ciphertext: string, key: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  return bytes.toString(CryptoJS.enc.Utf8);
}

export function computeSHA256(message: string): string {
  return CryptoJS.SHA256(message).toString();
}

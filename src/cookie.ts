import crypto from 'node:crypto'
import valueOrError, { preventThrow } from './return'
import { ValueOrError } from './types'

export interface SymmetricCrypto {
	encrypt: (input: string, from?: Format, to?: Format) => Promise<ValueOrError<string>>,
	decrypt: (input: string, from?: Format, to?: Format) => Promise<ValueOrError<string>>
}
type Format = 'base64' | 'hex' | 'utf-8'
export default function CookieCrypt(cookieKey: string) {
	const key = Buffer.from(cookieKey, 'hex')
	return {
		encrypt: async (input: string, from: Format = 'hex', to: Format = 'base64') => {
			const [cipher, err] = await preventThrow(() => crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16, 0)))
			if (err !== null) {
				return valueOrError<string>(err)
			}
			let encrypted = cipher.update(input, from, to)
			encrypted += cipher.final(to)
			return valueOrError(encrypted)
		},
		decrypt: async (input: string, from: Format = 'base64', to: Format = 'hex') => {
			const [decipher, err] = await preventThrow(() => crypto.createDecipheriv('aes-256-cbc', key, Buffer.alloc(16, 0)))
			if (err !== null) {
				return valueOrError<string>(err)
			}
			let decrypted = decipher.update(input, from, to)
			decrypted += decipher.final(to)
			return valueOrError(decrypted)
		}
	} as SymmetricCrypto
}
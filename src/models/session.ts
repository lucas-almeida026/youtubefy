import crypto from 'node:crypto'
import * as mysql from 'mysql2/promise'
import valueOrError, { preventThrow } from '../return'
import MemCache, { Accessor } from '../cache'
import { ValueOrError } from '../types'
import {Auth} from 'googleapis'
import { extractResponsePayload } from '../db'
import { User } from './user'
import {v4 as uuid} from 'uuid'
import CookieCrypt from '../cookie'
import { hours } from '../timing'
import { dateFromMs } from '../date'
import Env from '../env'
const [env] = Env()

export type SessionCreated = {
	token: string,
	userUUID: string,
	expiresAt_ms: number
}

type Session = {
	uuid: string,
	user_uuid: string,
	session_token: string,
	created_at: number,
	expires_at: number
}

export type SessionModelOk = Exclude<Awaited<ReturnType<typeof SessionModel>>, Error>
export class SessionTokenExpired extends Error {}

export default async function SessionModel(db: mysql.Pool) {
	const cache = MemCache<Record<string, SessionCreated>>({})
	async function randomKey(size: number) {
		return await preventThrow(() => crypto.randomBytes(size).toString('hex'))
	}
	const [key, err] = await randomKey(32)
	if (err !== null) {
		return err
	}
	const cookieCrypt = CookieCrypt(
		env && env.NODE_ENV === 'production'
		? key
		: (//@ts-ignore
			!(console.log('using predefined cookie key')) && 
			'c648004afc22e25698391a0addc7c3939863f280dcf338b76acf4ae04ca8f228')
		)
	return {
		async create(user: Omit<User, 'client_info'>) {
			const [rawToken, err1] = await randomKey(32)
			if (err1) {
				return valueOrError<SessionCreated>(err1)
			}
			const [encoded, err2] = await cookieCrypt.encrypt(rawToken)
			if (err2) {
				return valueOrError<SessionCreated>(err2)
			}
			const now = Date.now()
			const expiresMS = now + hours(24)
			const createdAt = dateFromMs(now)
			const expiresAt = dateFromMs(expiresMS)
			const [, err3] = await preventThrow(
				db.query(
					'insert into sessions (uuid, user_uuid, session_token, created_at, expires_at) values (?, ?, ?, ?, ?)',
					[uuid(), user.uuid, rawToken, createdAt, expiresAt]
				)
			)
			if (err3 !== null) {
				return valueOrError<SessionCreated>(err3)
			}
			const sessionObj: SessionCreated = {
				token: encoded,
				expiresAt_ms: expiresMS,
				userUUID: user.uuid
			}
			cache.set(rawToken, sessionObj)
			return valueOrError<SessionCreated>(sessionObj)
		},
		async verify(session: SessionCreated) {
			const [rawToken, err1] = await cookieCrypt.decrypt(session.token)
			if (err1 !== null) {
				return valueOrError<boolean>(err1)
			}
			const [fromCache] = cache.get(rawToken)
			if (fromCache !== null && fromCache.userUUID === session.userUUID) {
				if (fromCache.expiresAt_ms >= Date.now()) {
					return valueOrError<boolean>(true)
				} else {
					cache.unset(rawToken)
				}
			}
			const [res, err2] = await preventThrow(
				db.query(
					'select uuid, user_uuid from sessions where session_token = ? and user_uuid = ?',
					[rawToken, session.userUUID]
				)
			)
			if (err2 !== null) {
				return valueOrError<boolean>(err2)
			}
			const [payload, err3] = await extractResponsePayload(res, (x): x is Session => x instanceof Object && 'uuid' in x && 'user_uuid' in x)
			if (err3 !== null) {
				return valueOrError<boolean>(err3)
			}
			if (payload.expires_at < Date.now()) {
				cache.unset(rawToken)
				return valueOrError<boolean>(new SessionTokenExpired())
			}
			return valueOrError<boolean>(true)
		},
		async delete(session: SessionCreated) {
			const [, err] = await preventThrow(
				db.query(
					'delete from sessions where session_token = ? and user_uuid = ?',
					[session.token, session.userUUID]
				)
			)
			if (err !== null) {
				return valueOrError<boolean>(err)
			}
			cache.unset(session.token)
			return valueOrError<boolean>(true)
		}
	}
}
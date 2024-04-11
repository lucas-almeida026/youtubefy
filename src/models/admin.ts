import * as mysql from 'mysql2/promise'
import valueOrError, { preventThrow } from '../return'
import { Accessor } from '../cache'
import { ValueOrError } from '../types'
import {Auth} from 'googleapis'
import { DataIsEmpty, extractResponsePayload } from '../db'


export default function AdminModel(db: mysql.Pool, cache?: Accessor<unknown>) {
	async function countAdminUsers(): Promise<ValueOrError<number>> {
		const [res, err] = await preventThrow(
			db.query('select count(*) as total from admin')
		)
		if (err !== null || res === null) {
			return valueOrError<number>(err ?? new Error('Error querying database'))
		}
		type Total = {total: number}
		const isTotal = (x: any): x is Total => typeof x === 'object' && 'total' in x
		const [payload, err2] = await extractResponsePayload(res, isTotal)
		if (err2 !== null) {
			return valueOrError<number>(err2)
		}
		return valueOrError<number>(payload.total)
	}
	function maybeSetCache(key: string, value: unknown) {
		if (cache) {
			cache.set(key, value)
		}
	}
	return {
		async isSetUp(): Promise<ValueOrError<boolean>> {
			const KEY = 'isSetUp'
			let fromCache: boolean | null = null;
			if (cache) {
				const [val] = cache.get(KEY)
				if (val !== null && typeof val === 'boolean') {
					fromCache = val
				}
			}
			if (fromCache !== null) {
				return valueOrError<boolean>(fromCache)
			}
			const [total, err] = await countAdminUsers()
			if (err !== null && !(err instanceof DataIsEmpty)) {
				maybeSetCache(KEY, false)
				return valueOrError<boolean>(err)
			}
			if (err !== null && err instanceof DataIsEmpty) {
				maybeSetCache(KEY, false)
				return valueOrError<boolean>(false)
			}
			if (total === 0) {
				maybeSetCache(KEY, false)
				return valueOrError<boolean>(false)
			}
			if ((total as number) > 1) {
				return valueOrError<boolean>(new TooManyAdminUsers())
			}
			maybeSetCache(KEY, true)
			return valueOrError<boolean>(true)
		},
		async save({email, token}: {email: string, token: string}): Promise<ValueOrError<boolean>> {
			const [total, err] = await countAdminUsers()
			if (err !== null) {
				return valueOrError<boolean>(err)
			}
			if (total !== 0) {
				return valueOrError<boolean>(new Error('Admin user already exists'))
			}
			const [, err2] = await preventThrow(db.query('insert into admin (email, refresh_token) values (?, ?)', [email, token]))
			if (err2 !== null) {
				return valueOrError<boolean>(err2)
			}
			return valueOrError<boolean>(true)
		},
		async useAsAuth(client: Auth.OAuth2Client) {
			const [res, err] = await preventThrow(db.query('select * from admin'))
			if (err !== null) return valueOrError<boolean>(err)
			type AdminRow = {id: number,email: string, refresh_token: string}
			const isAdminRow = (x: any): x is AdminRow => typeof x === 'object' && 'email' in x && 'refresh_token' in x
			const [payload, err2] = await extractResponsePayload(res, isAdminRow)
			if (err2 !== null) return valueOrError<Auth.OAuth2Client>(err2)
			client.setCredentials({refresh_token: payload.refresh_token})
			return valueOrError<boolean>(true)
		}
	}
}

export class TooManyAdminUsers extends Error {}
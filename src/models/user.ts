import * as mysql from 'mysql2/promise'
import valueOrError, { preventThrow } from '../return'
import { Accessor } from '../cache'
import { ValueOrError } from '../types'
import {Auth} from 'googleapis'
import { DataIsEmpty, extractResponsePayload } from '../db'
import { v4 as uuid } from 'uuid'

export type User = {
	uuid: string,
	email: string,
	client_info: string
}
export class UserDoNotExist extends Error {}
export default function UserModel(db: mysql.Pool) {
	return {
		async getIfExists(email: string) {
			const [res] = await preventThrow(
				db.query('select uuid from users where email = ?', [email])
			)
			const [payload, err1] = await extractResponsePayload(res, (x): x is User => x instanceof Object && 'uuid' in x)
			if (err1 !== null) {
				if (err1 instanceof DataIsEmpty) {
					return valueOrError<User>(new UserDoNotExist())
				}
				return valueOrError<User>(err1)
			}
			return valueOrError<User>(payload)
		},
		async create(email: string, clientInfo: string) {
			const id = uuid()
			const [, err1] = await preventThrow(
				db.query(
					'insert into users (uuid, email, client_info) values (?, ?, ?)',
					[id, email, clientInfo]
				)
			)
			if (err1 !== null) {
				return valueOrError<User>(err1)
			}
			return valueOrError<User>({
				uuid: id,
				email,
				client_info: clientInfo
			})
		}
	}
}

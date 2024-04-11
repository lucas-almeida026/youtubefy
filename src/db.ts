import * as mysql from 'mysql2/promise'
import { seconds, wait } from './timing'
import { ValueOrError } from './types'
import valueOrError from './return'
import Env, { EnvObject } from './env'

const env = Env()[0] as EnvObject

export default async function getDB() {
	const db = mysql.createPool({
		user: env.DB_USERNAME,
		password: env.DB_PASSWORD,
		database: env.DB_NAME,
		host: env.DB_HOST,
	})
	let error = true;
	let timeout = 1;
	while (error && timeout < 64) {
		try {
			console.log('trying to connect to db, timeout =', timeout)
			await wait(seconds(timeout))
			await db.query('select 1')
			error = false
		} catch (err) {
			error = true
		}
		timeout = timeout * 2
	}
	if (error) {
		throw new Error('unable to connect to db')
	}
	return db
}

export class NoDbResponse extends Error { }
export class DataIsEmpty extends Error { }
export class InvalidPayloadType extends Error {
	constructor(public readonly message: string) {super()}
}

export async function extractResponsePayload<T>(response: [mysql.QueryResult, mysql.FieldPacket[]] | null, verifier: (x: any) => x is T): Promise<ValueOrError<T>> {
	if (response === null) {
		return valueOrError<T>(new NoDbResponse())
	}
	const [data] = response
	if (!(data instanceof Array) || data.length === 0) {
		return valueOrError<T>(new DataIsEmpty())
	}
	const [payload] = data
	if (typeof payload !== 'object') {
		return valueOrError<T>(new InvalidPayloadType('expecting and object'))
	}
	if (!verifier(payload)) {
		return valueOrError<T>(new InvalidPayloadType('the object does not match the expected type'))
	}
	return valueOrError<T>(payload)
}

export async function createUsersTable(db: mysql.Pool) {
	try {
		await db.query(`create table if not exists users (
			uuid varchar(36) primary key,
			email varchar(255) not null,
			client_info JSON,
			unique (email)
		)`)
		console.log('Users table created')
	} catch (err) {
		console.log('Error creating users table:', err)
	}
}

export async function createSessionsTable(db: mysql.Pool) {
	try {
		await db.query(`create table if not exists sessions (
			uuid varchar(36) primary key,
			user_uuid varchar(36) not null,
			session_token varchar(255) not null,
			created_at timestamp default current_timestamp,
			expires_at timestamp not null,
			foreign key (user_uuid) references users (uuid),
			unique (session_token, user_uuid)
		)`)
		console.log('Sessions table created')
	} catch(err) {
		console.log('Error creating sessions table:', err)
	}
}

export async function createAdminTable(db: mysql.Pool) {
	try {
		await db.query(`create table if not exists admin (
			id int auto_increment primary key not null,
			email varchar(255) not null,
			refresh_token varchar(255) not null
		)`)
		console.log('Admin table created')
	} catch(err) {
		console.log('Error creating admin table:', err)
	}
}

export async function createDatabaseTables(db: mysql.Pool) {
	try {
		await Promise.all([
			createUsersTable(db),
			createSessionsTable(db),
			createAdminTable(db)
		])
	} catch(err) {
		console.log(err)
	}
}
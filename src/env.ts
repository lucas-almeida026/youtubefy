import dotenv from 'dotenv'
import { parseMultilineRSAKey } from './parsing'
import valueOrError from './return'
dotenv.config();

const PORT = process.env.PORT || 8080
const CLIENT_ID = process.env['CLIENT_ID']
const CLIENT_SECRET = process.env['CLIENT_SECRET']
const REDIRECT_URL = process.env['REDIRECT_URL']
const PRIVATE_KEY = parseMultilineRSAKey(process.env['PRIVATE_KEY'] ?? '')
const PUBLIC_KEY = parseMultilineRSAKey(process.env['PUBLIC_KEY'] ?? '')
const ADMIN_PUB_KEY = parseMultilineRSAKey(process.env['ADMIN_PUB_KEY'] ?? '')
const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD']
const COOKIE_KEY = process.env['COOKIE_KEY']
const USER_PASSWORD = process.env['USER_PASSWORD']
const DB_USERNAME = process.env['DB_USERNAME']
const DB_PASSWORD = process.env['DB_PASSWORD']
const DB_HOST = process.env['DB_HOST']
const DB_NAME = process.env['DB_NAME']
const NODE_ENV = process.env['NODE_ENV'] ?? 'production'
const CORS = process.env['CORS'] ?? '*'
class MissingEnvVar extends Error {
	constructor(public readonly varName: string) {super()}
}

const env = {
	CLIENT_ID,
	CLIENT_SECRET,
	REDIRECT_URL,
	PRIVATE_KEY,
	PUBLIC_KEY,
	ADMIN_PUB_KEY,
	ADMIN_PASSWORD,
	COOKIE_KEY,
	USER_PASSWORD,
	DB_USERNAME,
	DB_PASSWORD,
	DB_HOST,
	DB_NAME,
	// with defaults
	CORS,
	PORT,
	NODE_ENV,
}

export type EnvObject = {
	[key in keyof typeof env]: string
}

export default function Env() {
	if (!CLIENT_ID) return valueOrError<EnvObject>(new MissingEnvVar('CLIENT_ID'))
	if (!CLIENT_SECRET) return valueOrError<EnvObject>(new MissingEnvVar('CLIENT_SECRET'))
	if (!REDIRECT_URL) return valueOrError<EnvObject>(new MissingEnvVar('REDIRECT_URL'))
	if (!PRIVATE_KEY) return valueOrError<EnvObject>(new MissingEnvVar('PRIVATE_KEY'))
	if (!PUBLIC_KEY) return valueOrError<EnvObject>(new MissingEnvVar('PUBLIC_KEY'))
	if (!ADMIN_PUB_KEY) return valueOrError<EnvObject>(new MissingEnvVar('ADMIN_PUB_KEY'))
	if (!ADMIN_PASSWORD) return valueOrError<EnvObject>(new MissingEnvVar('ADMIN_PASSWORD'))
	if (!COOKIE_KEY) return valueOrError<EnvObject>(new MissingEnvVar('COOKIE_KEY'))
	if (!USER_PASSWORD) return valueOrError<EnvObject>(new MissingEnvVar('USER_PASSWORD'))
	
	if (!DB_HOST) return valueOrError<EnvObject>(new MissingEnvVar('DB_HOST'))
	if (!DB_NAME) return valueOrError<EnvObject>(new MissingEnvVar('DB_NAME'))
	if (!DB_PASSWORD) return valueOrError<EnvObject>(new MissingEnvVar('DB_PASSWORD'))
	if (!DB_USERNAME) return valueOrError<EnvObject>(new MissingEnvVar('DB_USERNAME'))
	return valueOrError<EnvObject>(env as EnvObject)
}
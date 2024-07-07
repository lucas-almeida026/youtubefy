import { google } from 'googleapis'
import Env from './src/env'
import express from 'express'
import path from 'node:path'
import fs from 'node:fs/promises'

const app = express()
app.use(express.json())

const SCOPES = [
	'https://www.googleapis.com/auth/youtube',
]

const [env, err0] = Env()

if (err0 !== null) {
	console.error(err0)
	process.exit(1)
}
if (!process.env.HOME || typeof process.env.HOME !== 'string') {
	console.error('HOME is not set')
	process.exit(1)
}
const DATA_FOLDER_PATH = path.join(process.env.HOME, '.youtubefy')
const DATA_FILE_PATH = path.join(DATA_FOLDER_PATH, 'data.json')

const ytClient = google.youtube('v3')
const authClient = new google.auth.OAuth2(
	env.CLIENT_ID,
	env.CLIENT_SECRET,
	'http://localhost:8080/youtube-oauth2-callback'
)

const authURL = authClient.generateAuthUrl({
	access_type: 'offline',
	scope: SCOPES
})

// const rl = readline.createInterface({
// 	input: process.stdin,
// 	output: process.stdout
// })

let handledFirstRequest = false
let server: {close: () => void} | null = null

app.get('/youtube-oauth2-callback', async (req, res) => {
	const code = req.query.code
	if (!code) {
		return res.status(500).send('No code')
	}
	if (handledFirstRequest) {
		console.log('Server is not responding anymore')
		return res.send('')
	}
	const { tokens } = await authClient.getToken(String(code))
	authClient.setCredentials(tokens)
	await fs.writeFile(DATA_FILE_PATH, JSON.stringify(tokens), 'utf-8')
	console.clear()
	res.send('')
	if (server) {
		server.close()
	}
})


createFolderStructureIfNotExists(DATA_FOLDER_PATH)
.then(async () => {
	try {
		const contents =  await fs.readFile(DATA_FILE_PATH, 'utf-8')
		return [true, contents] as [boolean, string]
	} catch (e) {
		return [false, ''] as [boolean, string]
	}
})
.then(async ([ok, contents]) => {
	if (!ok) {
		server = app.listen(8080, () => {
			console.log('Visit the following URL in your browser to authorize this app:\n', authURL)
		})
		return
	}
	const tokens = JSON.parse(contents)
	if (!tokens) {
		return console.log('Tokens not found')
	}
	authClient.setCredentials(tokens)
	google._options.auth
	ytClient.playlists.list({
		auth: authClient,
		part: ['snippet', 'contentDetails', 'id', 'status'],
		mine: true,
		maxResults: 40
	})
	.then(r => {
		console.log(r?.data?.items?.map(x => x?.snippet?.title))
	})
	.catch(err => {
		console.error(err)
	})
})
.catch(err => {
	console.error(err)
})

// rl.question('Enter the code from that page here: ', (code) => {
// 	rl.close()
// 	console.log('The code is:', code)
// })
async function createFolderStructureIfNotExists(p: string) {
	try {
		await fs.access(p)
	} catch (err) {
		await fs.mkdir(p, { recursive: true })
	}
}
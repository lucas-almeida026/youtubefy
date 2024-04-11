import fs from 'node:fs/promises'
import crypto from 'node:crypto'

import express, { NextFunction, Request, Response } from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import pup, { Page } from 'puppeteer'
import { google, youtube_v3 } from 'googleapis'
import { hours, seconds, wait } from './timing'
import { spotifyLogin } from './spotify'
import { getVideoIds, insertVideoOnPlaylist } from './youtube'
import childProcess from 'node:child_process'
import { parseMultilineRSAKey } from './parsing'
import createRenderer$ from './templates'
import Mutex from './mutex'
import createDB, { createDatabaseTables } from './db'
import { v4 as uuid } from 'uuid'
import AdminModel, { TooManyAdminUsers } from './models/admin'
import MemCache from './cache'
import { preventThrow } from './return'
import { ValueOrError } from './types'
import { maybeServerIsNotReady } from './middlewares'
import CookieCrypt from './cookie'
import Routes from './routes'
import Env from './env'
import { rateLimit } from 'express-rate-limit'
import serverState from './state'
import UserModel from './models/user'
import SessionModel, { SessionCreated } from './models/session'


(async () => {

	const [env, err0] = Env()
	if (err0 !== null) {
		console.error(err0)
		process.exit(1)
	}

	const app = express()
	app.use(express.json())
	app.use(express.urlencoded({ extended: false }))
	app.use(cookieParser())

	const loginMagicLinkLimiter = rateLimit({
		windowMs: hours(1),
		limit: 3,
		standardHeaders: 'draft-7',
		legacyHeaders: false,
		skipFailedRequests: true,
		validate: true,
		message: JSON.stringify({ code: 429, message: 'Too many requests' })
	})
	const generalLoginLimiter = rateLimit({
		windowMs: hours(1),
		limit: 15,
		standardHeaders: 'draft-7',
		legacyHeaders: false,
		validate: true
	})

	const gmailClient = google.gmail('v1')
	const authClient = new google.auth.OAuth2(
		env.CLIENT_ID,
		env.CLIENT_SECRET,
		env.REDIRECT_URL
	)
	const cookieCrypt = CookieCrypt(env.COOKIE_KEY)


	const [db, err1] = await preventThrow(createDB)
	if (err1 !== null) {
		console.error('Error creating database:', err1)
		process.exit(1)
	}

	const [, err2] = await preventThrow(() => createDatabaseTables(db))
	if (err2 !== null) {
		console.error('Error creating database tables:', err2)
		process.exit(1)
	} else {
		console.log('Database created successfully')
	}
	const adminModel = AdminModel(db)
	const userModel = UserModel(db)
	const sessionModel = await SessionModel(db)
	if (sessionModel instanceof Error) {
		console.error('Error creating session model:', sessionModel)
		process.exit(1)
	}
	const [isSetUp, err3] = await adminModel.isSetUp()
	if (err3 !== null) {
		if (err3 instanceof TooManyAdminUsers) {
			console.error('Fatal Error: Too many admin users')
			process.exit(1)
		}
	}
	if (!isSetUp) {
		console.log('Waiting for setup...')
	} else {
		const [, err] = await adminModel.useAsAuth(authClient)
		if (err !== null) {
			console.error('Error using admin auth:', err)
			process.exit(1)
		} else {
			google._options.auth = authClient
			console.log('Admin auth used successfully')
		}
	}

	const tailwindcss = await fs.readFile('./src/templates/output.css', 'utf-8')
	const htmx = await fs.readFile('./src/templates/htmx.js', 'utf-8')
	const tailwind_style_tag = `<style>${tailwindcss}</style>`
	const htmx_script_tag = `<script>${htmx}</script>`
	const defaultTemplate = `<!DOCTYPE html>
	<html lang="en">
	<head>
	  <meta charset="UTF-8">
	  <meta name="viewport" content="width=device-width, initial-scale=1.0">
	  <title>Youtubefy - Error</title>
	</head>
	<body>
	  <h1>Error loading template files</h1>
	</body>
	</html>`
	const renderer = await createRenderer$('./src/templates', defaultTemplate)
	const serverNotReadyPage = renderer.page('base', 'notReady').renderOrDefault(
		{ tailwind_style_tag },
		{}
	)

	const browser = await pup.launch({
		headless: process.env['HEADLESS'] === '1',
		args: ['--no-sandbox', '--window-size=1440,900', '--start-minimized'],
		ignoreDefaultArgs: ['--disable-extensions'],
		executablePath: '/usr/bin/chromium-browser'
	})
	const page = await browser.newPage()
	await page.setViewport({ width: 1430, height: 890 })



	let playlist_json: any, spotifyInterval: any
	let HAND_SHAKE_KEY: Buffer | null = null
	let USER_SESSION_ID: string | null = 'bde8c903a82b998769fc24e0fc471d1b' //TODO: remove it for build

	const validateSessionCookie = async (req: Request, res: Response, next: NextFunction) => {
		const { admin } = req.cookies
		if (USER_SESSION_ID === null) {
			return res.status(401).send('Expired or not initialized')
		}
		if (!admin) return res.status(401).send('Unauthorized')
		const [decrypted, err] = await cookieCrypt.decrypt(admin)
		if (err !== null) {
			return res.status(500).send('Internal server error; unable to decrypt session ID')
		}
		if (decrypted !== USER_SESSION_ID) return res.status(401).send('Unauthorized')
		next()
	}

	playlist_json = `{
  "title": "Youtubefy - This Is Bring Me The Horizon",
  "pairs": [
    [
      "Kool-Aid",
      "Bring Me The Horizon"
    ],
    [
      "DArkSide",
      "Bring Me The Horizon"
    ],
    [
      "Throne",
      "Bring Me The Horizon"
    ]
  ]
}`
	// try {
	//   playlist_json = await fs.readFile('./playlist.json', 'utf-8')
	//   console.log('playlist.json found')
	// } catch (err) {
	//   console.log('Unable to read playlist.json')
	//   console.log('Starting sportify login procedure...')
	//   spotifyInterval = await spotifyLogin(browser, page)
	// }
	const ytClient = google.youtube('v3')

	if (env.NODE_ENV === 'production') {
		app.use(cors({ origin: env.CORS }))
	} else {
		app.use(cors())
	}
	
	app.use(Routes({
		cookieCrypt,
		authClient,
		gmailClient,
		adminModel,
		userModel,
		sessionModel,
		renderer,
		tailwind_style_tag,
		htmx_script_tag,
		loginMagicLinkLimiter,
		generalLoginLimiter,
	}))

	app.get('/', (req, res) => {
		return res.send(
			renderer
				.page('base', 'index')
				.renderOrDefault({ tailwind_style_tag, htmx_script_tag }, { title: 'v0.1.1-alpha' })
		)
	})

	app.get('/app', (req, res) => {
		const { session } = req.cookies
		if (!session) {
			return res.redirect('/login')
		}
		return res.send(
			renderer
				.page('authenticated', 'app')
				.renderOrDefault(
					{ tailwind_style_tag, htmx_script_tag },
					{}
				)
		)
	})

	app.get('/logout', async (req, res) => {
		const { session } = req.cookies
		if (!session) {
			return res.redirect('/login')
		}
		const [decoded] = await cookieCrypt.decrypt(session, 'base64', 'utf-8')
		if (decoded !== null) {
			const [sessionObj, err] = await preventThrow(() => JSON.parse(decoded) as SessionCreated)
			if (err !== null) {
				console.error('unable to parse session', err)
			}
			if (sessionObj) {
				const [verified, err2] = await sessionModel.verify(sessionObj)
				if (err2 !== null) {
					console.error('unable to verify session', err2)
				}
				if (verified) {
					const [, err] = await sessionModel.delete(sessionObj)
					if (err !== null) {
						console.error('unable to delete session', err)
						return res.status(500).send('Internal server error; unable to delete session')
					}
					res.clearCookie('session')
					res.setHeader('HX-Redirect', '/login')
					return res.status(200).send('Logged out')
				}
			}
		}
		console.log('could not log out')
		return res.status(500).send('Could not log out')
	})


	app.get('/handshake', async (req, res) => {
		const { pwd } = req.query
		if (!pwd) {
			HAND_SHAKE_KEY = crypto.randomBytes(32)
			const encryptedSymetricKey = crypto.publicEncrypt(env.ADMIN_PUB_KEY as string, HAND_SHAKE_KEY)
			return res.send({ key: encryptedSymetricKey.toString('base64') })
		} else {
			if (typeof pwd !== 'string') return res.status(400).send('Expecting pwd but found nothing')
			if (!HAND_SHAKE_KEY) return res.status(422).send('Handshake not initiated')
			const decipher = crypto.createDecipheriv('aes-256-cbc', HAND_SHAKE_KEY, Buffer.alloc(16, 0))
			HAND_SHAKE_KEY = null
			let decryptedData = decipher.update(pwd, 'base64', 'utf-8')
			decryptedData += decipher.final('utf-8')
			if (env.ADMIN_PASSWORD === decryptedData) {
				const [randomId, err0] = await preventThrow(() => crypto.randomBytes(16).toString('hex'))
				if (err0 !== null) {
					return res.status(500).send('Internal server error; unable to generate session ID')
				}
				serverState.set('ADMIN_USER_ID', randomId)
				const [cookieData, err] = await cookieCrypt.encrypt(randomId)
				if (err !== null) {
					return res.status(500).send('Internal server error; unable to encrypt session ID')
				}
				res.cookie('user_id', cookieData, { httpOnly: true, maxAge: seconds(90) })
				const AUTH_URL = authClient.generateAuthUrl({
					access_type: 'offline',
					scope: [
						'https://www.googleapis.com/auth/youtube',
						'https://mail.google.com/',
					],
					redirect_uri: `${env.NODE_ENV === 'production' ? 'https' : 'http'}://${req.get('host')}/youtube-oauth2-callback`,
				})
				return res.redirect(AUTH_URL)
			}
			res.status(401).send('Wrong password')
		}
	})

	app.get('/adm-login', async (req, res) => {
		const { pwd } = req.query
		if (!pwd) return res.status(400).send('Expecting pwd but found nothing')
		if (pwd !== env.USER_PASSWORD) return res.status(401).send('Wrong password')
		USER_SESSION_ID = crypto.randomBytes(16).toString('hex')
		const [cookieData, err] = await cookieCrypt.encrypt(USER_SESSION_ID)
		if (err !== null) {
			return res.status(500).send('Internal server error; unable to encrypt session ID')
		}
		res.cookie('admin', cookieData, { httpOnly: true, maxAge: hours(12) })
		res.send('ok')
	})

	app.get('/adm-logout', (req, res) => {
		USER_SESSION_ID = null
		res.clearCookie('admin')
		res.send('logged out')
	})

	app.get('/kill', validateSessionCookie, async (req, res) => {
		await browser.close()
		console.log('Browser closed')
		res.send('killed')
	})

	app.get('/inspect', validateSessionCookie, (req, res) => {
		//spawn linux terminal with command ps aux | grep -E '[c]hrome|[c]hromium'
		childProcess.exec('ps aux | grep -E \'[c]hrome|[c]hromium\'', (err, stdout, stderr) => {
			if (err) {
				return res.status(500).send(err?.message ?? 'Error spawning process')
			}
			return res.send(stdout.replace(/(?:\n|\r\n)/g, '<br>'))
		})
	})

	app.get('/run', maybeServerIsNotReady(adminModel.isSetUp, serverNotReadyPage), validateSessionCookie, async (req, res) => {
		if (!browser) return res.status(500).send('Browser not initialized')
		if (!google._options.auth) return res.status(500).send('Google auth not initialized')
		let title, pairs
		if (playlist_json) {
			console.log('Reading from playlist.json...')
			const obj = JSON.parse(playlist_json)
			title = obj.title
			pairs = obj.pairs.slice(0, 3) //FIXME: remove cap later
		} else {
			console.log('Reading from spotify...')
			const scrape = await scrapePlaylistPage('https://open.spotify.com/playlist/37i9dQZF1DZ06evO0VDZny')
			title = scrape.title
			pairs = scrape.pairs.slice(0, 3) //FIXME: remove cap later
			await fs.writeFile('./playlist.json', JSON.stringify({ title, pairs }, null, 2))
		}
		if (spotifyInterval) {
			clearInterval(spotifyInterval)
		}
		console.log('Successfully scraped playlist\n')
		console.log('Getting youtube playlists...')
		const playlistsRes = await ytClient.playlists.list({ part: ['snippet', 'contentDetails', 'id', 'status'], mine: true, maxResults: 40 })
		if (playlistsRes?.data?.items) {
			try {
				const videoIds = await getVideoIds(browser, pairs)
				let playlistExists = false
				let playlist: youtube_v3.Schema$Playlist
				for (const item of playlistsRes.data.items) {
					if (item.snippet?.title === title) {
						playlistExists = true
						playlist = item
						break
					}
				}
				let playlistURL = ''
				if (playlistExists) {
					console.log('Playlist already exists')
					//check for titles
					//@ts-ignore
					playlistURL = `https://www.youtube.com/playlist?list=${playlist.id}`
					const { data: plItems } = await ytClient.playlistItems.list({
						part: ['snippet'],
						//@ts-ignore
						playlistId: playlist.id as string,
						maxResults: 50,
					})
					console.log('Checking for duplicates...')
					for (let i = 0; i < (plItems.items?.length ?? 0); i++) {
						//@ts-ignore
						const item = plItems.items[i]
						const vid = videoIds[i]
						if (!!vid && !!item && (vid !== item.snippet?.resourceId?.videoId)) {
							console.log('Inserting video: ' + vid)
							//@ts-ignore
							await insertVideoOnPlaylist(ytClient, playlist.id, vid)
						} else {
							console.log('Video is already included: ' + vid)
						}
					}
					return res.send('Finished: ' + playlistURL)
				} else {
					console.log('Playlist does not exist, creating...')
					//create
					const plCreated = await ytClient.playlists.insert({
						part: ['snippet', 'contentDetails', 'id', 'status'],
						requestBody: {
							kind: 'youtube#playlist',
							snippet: {
								description: 'Youtubefy is an automated tool that transports your favorite playlists from Spotify over to YouTube.',
								title,
								tags: ['youtubefy', 'music', 'playlist'],
							},
							status: {
								privacyStatus: 'public',
							}
						}
					})
					const plId = plCreated.data.id
					console.log('Playlist created successfully, id: ' + plId)
					//populate - required: snippet.playlistId, snippet.resourceId
					if (plId) {
						playlistURL = `https://www.youtube.com/playlist?list=${plId}`
						for (const vid of videoIds) {
							console.log('Inserting video: ' + vid)
							await insertVideoOnPlaylist(ytClient, plId, vid)
						}
					} else {
						return res.send('Error: Playlist was not created')
					}
				}
				return res.send('Finished: ' + playlistURL)
			} catch (err) {
				console.log(err)
				res.send(err)
			}
		} else {
			return res.status(404).send('Error: Unable to list users playlists')
		}
		res.end('Finishe')
	})

	app.listen(env.PORT, () => console.log('server running on port ' + env.PORT))

	process.once('SIGINT', async () => {
		console.log('closing browser')
		await browser.close()
	})
	process.once('SIGTERM', async () => {
		console.log('closing browser')
		await browser.close()
	})

	async function scrapePlaylistPage(url: string): Promise<{ title: string, pairs: string[][] }> {
		await page.goto(url)
		await wait(seconds(4))
		console.log('Waiting for playlist to load...')
		const grid = await page.$('div[role="grid"]')
		if (!grid) {
			console.log('Error: Grid not found')
			throw Error('Grid not found')
		}
		const namesList = await grid.$$('div[data-encore-id="text"]')
		if (!namesList) {
			console.log('Error: Names list not found')
			throw Error('Names list not found')
		}
		await wait(seconds(4))
		await scrollAll(page)
		console.log('Playlist loaded, parsing names...')
		const playlistNameEl = await page.$('h1[data-encore-id="text"]')
		if (!playlistNameEl) {
			console.log('Error: Playlist name not found')
			throw Error('Playlist name not found')
		}
		const playlistName = 'Youtubefy - ' + (await playlistNameEl.evaluate(node => node.innerText))
		console.log(`Playlist name: ${playlistName}`)
		const nameListStr: string[] = []
		for (const name of namesList) {
			const contents = await name.evaluate(node => node.innerText)
			nameListStr.push(contents)
		}
		console.log('Names aquired, creating pairs...')
		const pairs: string[][] = []
		for (let i = 0; i < nameListStr.length; i += 3) {
			let temp: string[] = []
			for (let j = 0; j < 3; j++) {
				if (j < 2) {
					temp.push(nameListStr[i + j])
				}
			}
			pairs.push(temp)
		}
		return {
			title: playlistName,
			pairs
		}
	}
})()

function scrollAll(page: Page) {
	return page.evaluate(async () => {
		let totalHeight = 0
		let distance = 100
		let timer = setInterval(() => {
			let scrollHeight = document.body.scrollHeight
			window.scrollBy(0, distance)
			totalHeight += distance

			if (totalHeight >= scrollHeight - window.innerHeight) {
				clearInterval(timer)
				return
			}
		}, 100)
	})
}

//'https://open.spotify.com/playlist/37i9dQZF1DZ06evO0VDZny'

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
import Env, { EnvObject } from './env'
import { rateLimit } from 'express-rate-limit'
import serverState from './state'
import UserModel from './models/user'
import SessionModel, { SessionCreated } from './models/session'


export type Sender = {
	log: (msg: string) => void,
	prog: (percent: number) => void
}

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

	let browser = await pup.launch({
		headless: process.env?.['HEADLESS'] === '1',
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
				.renderOrDefault({ tailwind_style_tag, htmx_script_tag }, { title: 'v0.1.2-alpha' })
		)
	})

	app.get('/app', maybeServerIsNotReady(adminModel.isSetUp, serverNotReadyPage), (req, res) => {
		const { session } = req.cookies
		if (!session) {
			return res.redirect('/login')
		}
		const after_script = `<script>
let running = false;
let history = [];
const btn = document.querySelector('button#youtubefy')
const input = document.querySelector('input')
const output = document.querySelector('div#output')
const pRunning = document.querySelector('p#running')
const result = document.querySelector('a#result')
const logDiv = document.querySelector('div#logs')
const progFill = document.querySelector('div#progress')

if (btn && input && output && result && pRunning && logDiv && progFill) {
	result.disabled = true
	pRunning.style.display = 'none'
	progFill.style.display = 'none'
	
	btn.addEventListener('click', async () => {
		if (!running) {
			if (input.value === '') {
				return alert('Please enter a playlist URL or ID')
			}
			if (!(/^(?:[a-zA-Z0-9]{22}|https:\\/\\/open.spotify.com\\/playlist\\/[a-zA-Z0-9]{22})$/.test(input.value))) {
				return alert('Please enter a valid playlist URL or ID')
			}
			toggleRunning()
			fetch('/run', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ playlist: input.value })
			})
			.then(response => {
				let buffer = '';
				const decoder = new TextDecoder();
				const reader = response.body?.getReader()
				if (!reader) throw new Error('No reader')
				return new ReadableStream({
					start(controller) {
						function push() {
							reader.read().then(({ done, value }) => {
								if (done) {
									if (buffer) controller.enqueue(buffer)
									controller.close()
									return
								}
								const chunk = decoder.decode(value, { stream: true })
								buffer += chunk
								if ((buffer.match(/\\n/g) || []).length >= 2) {
									controller.enqueue(buffer)
									const lines = buffer.split('\\n')
									for (const l of lines.slice(0, -1)) {
										const i = l.indexOf(':')
										const k = l.slice(0, i)
										const v = l.slice(i + 1)
										if (k === 'log') {
											onLog(v)
										} else if (k === 'prog') {
											onProg(v)
										} else if (k === 'end') {
											onResult(v)
										} else {
											console.warn('Unknown key: ' + k)
										}
									}
									buffer = ''
								}
								push()
							})
						}
						push()
					}
				})
			})
		}
	})
}
function toggleRunning() {
	if (running) {
		running = false

		btn.innerHTML = 'Youtubefy'
		btn.disabled = false

		input.disabled = false

		pRunning.style.display = 'none'
	} else {
		running = true

		btn.innerHTML = 'Running...'
		btn.disabled = true

		input.disabled = true

		setTimeout(() => {
			pRunning.style.display = 'block'
		}, 1000)
	}
}
function onLog(msg) {
	console.log({msg})
	pushLog(msg)
}
function onProg(percentage) {
	progFill.style.display = 'block'
	progFill.style.width = String(percentage) + '%'
	console.log({ percentage })
}
function onResult(data) {
	progFill.style.width = '100%'
	toggleRunning()
	console.log(data)
	result.href = data
	result.innerHTML = \`Youtubefied Playlist of \${data}\`
	progFill.style.display = 'none'
}
function pushLog(text) {
	const pEl = document.createElement('p')
	pEl.innerHTML = text
	pEl.classList.add('text-gray-500', 'text-sm', 'leading-none')
	logDiv.appendChild(pEl)
	logDiv.scrollTop = logDiv.scrollHeight
}
		</script>`
		return res.send(
			renderer
				.page('authenticated', 'app')
				.renderOrDefault(
					{ tailwind_style_tag, htmx_script_tag, after_script },
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
					redirect_uri: atRoute('youtube-oauth2-callback', String(req.get('host'))),
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

	app.get('/restart', validateSessionCookie, async (req, res) => {
		browser = await pup.launch({
			headless: process.env?.['HEADLESS'] === '1',
			args: ['--no-sandbox', '--window-size=1440,900', '--start-minimized'],
			ignoreDefaultArgs: ['--disable-extensions'],
			executablePath: '/usr/bin/chromium-browser'
		})
		res.send('restarted')
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

	app.post('/run', async (req, res) => {
		const { playlist } = req.body
		if (!playlist) return res.status(400).send('Expecting playlist but found nothing')
		if (typeof playlist !== 'string') return res.status(400).send('Expecting playlist to be a string')
		let pId
		if (playlist.startsWith('https://open.spotify.com/playlist/')) {
			pId = playlist.split('https://open.spotify.com/playlist/')[1]
		} else {
			pId = playlist
		}
		if (!(/^[a-zA-Z0-9]{22}$/.test(pId))) return res.status(400).send('Expecting playlist to be a valid playlist URL or ID')
		if (!browser) return res.status(500).send('Browser not initialized')
		if (!google._options.auth) return res.status(500).send('Google auth not initialized')
		let title, data
		res.setHeader('Content-Type', 'text/plain')
		res.setHeader('Transfer-Encoding', 'chunked')

		let sender_done = false
		const sender = {
			log: (msg: string) => {
				if (sender_done) return
				console.log(msg)
				res.write('log:'+msg+'\n')
			},
			prog: (n: number) => {
				if (sender_done) return
				res.write('prog:'+n+'\n')
			},
			end: (data: string, status = 200) => {
				if (!sender_done) {
					sender_done = true
					res.statusCode = status
					res.write('end:'+data+'\n')
					res.end()
				}
			}
		}
		sender.prog(1)
		sender.log('Scraping spotify playlist...')
		const scrape = await scrapePlaylistPage('https://open.spotify.com/playlist/' + pId, sender)
		title = scrape.title
		data = scrape.data
		console.log(data)
		if (spotifyInterval) {
			clearInterval(spotifyInterval)
		}
		sender.log('Successfully scraped playlist: total = ' + data.length)
		sender.log('Getting youtube playlists...')
		const playlistsRes = await ytClient.playlists.list({ part: ['snippet', 'contentDetails', 'id', 'status'], mine: true, maxResults: 40 })
		if (playlistsRes?.data?.items) {
			sender.prog(33)
			try {
				const videoIds = await getVideoIds(browser, data, sender)
				sender.prog(50)
				console.log(videoIds)
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
					sender.log('Playlist already exists')
					//check for titles
					//@ts-ignore
					playlistURL = `https://www.youtube.com/playlist?list=${playlist.id}`
					const { data: plItems } = await ytClient.playlistItems.list({
						part: ['snippet'],
						//@ts-ignore
						playlistId: playlist.id as string,
						maxResults: 50,
					})
					sender.prog(80)
					sender.log('Checking for duplicates...')
					for (let i = 0; i < (plItems.items?.length ?? 0); i++) {
						//@ts-ignore
						const item = plItems.items[i]
						const vid = videoIds[i]
						if (!!vid && !!item && (vid !== item.snippet?.resourceId?.videoId)) {
							sender.log('Inserting video: ' + vid)
							//@ts-ignore
							await insertVideoOnPlaylist(ytClient, playlist.id, vid)
						} else {
							sender.log('Video is already included: ' + vid)
						}
					}
					return sender.end(playlistURL)
				} else {
					sender.log('Playlist does not exist, creating...')
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
					sender.log('Playlist created successfully, id: ' + plId)
					//populate - required: snippet.playlistId, snippet.resourceId
					sender.prog(90)
					if (plId) {
						playlistURL = `https://www.youtube.com/playlist?list=${plId}`
						for (const vid of videoIds) {
							sender.log('Inserting video: ' + vid)
							await insertVideoOnPlaylist(ytClient, plId, vid)
						}
					} else {
						sender.log('Error: Playlist was not created')
						return sender.end('')
					}
				}
				return sender.end(playlistURL)
			} catch (err) {
				sender.log(typeof err === 'object' ? JSON.stringify(err) : 'error happened')
				sender.end('')
			}
		} else {
			sender.log('Error: Unable to list users playlists')
			return sender.end('')
		}
		sender.end('')

		// title = scrape.title
		// pairs = scrape.pairs.slice(0, 3)
		// setTimeout(() => {
		// 	res.send({scrape})
		// }, 2000)
	})

	// app.get('/run', maybeServerIsNotReady(adminModel.isSetUp, serverNotReadyPage), validateSessionCookie, async (req, res) => {
	// 	if (!browser) return res.status(500).send('Browser not initialized')
	// 	if (!google._options.auth) return res.status(500).send('Google auth not initialized')
	// 	let title, pairs
	// 	if (playlist_json) {
	// 		console.log('Reading from playlist.json...')
	// 		const obj = JSON.parse(playlist_json)
	// 		title = obj.title
	// 		pairs = obj.pairs.slice(0, 3) //FIXME: remove cap later
	// 	} else {
	// 		console.log('Reading from spotify...')
	// 		const scrape = await scrapePlaylistPage('https://open.spotify.com/playlist/37i9dQZF1DZ06evO0VDZny', {log: () => {}, prog: () => {}})
	// 		title = scrape.title
	// 		pairs = scrape.pairs.slice(0, 3) //FIXME: remove cap later
	// 		await fs.writeFile('./playlist.json', JSON.stringify({ title, pairs }, null, 2))
	// 	}
	// 	if (spotifyInterval) {
	// 		clearInterval(spotifyInterval)
	// 	}
	// 	console.log('Successfully scraped playlist\n')
	// 	console.log('Getting youtube playlists...')
	// 	const playlistsRes = await ytClient.playlists.list({ part: ['snippet', 'contentDetails', 'id', 'status'], mine: true, maxResults: 40 })
	// 	if (playlistsRes?.data?.items) {
	// 		try {
	// 			const videoIds = await getVideoIds(browser, pairs)
	// 			let playlistExists = false
	// 			let playlist: youtube_v3.Schema$Playlist
	// 			for (const item of playlistsRes.data.items) {
	// 				if (item.snippet?.title === title) {
	// 					playlistExists = true
	// 					playlist = item
	// 					break
	// 				}
	// 			}
	// 			let playlistURL = ''
	// 			if (playlistExists) {
	// 				console.log('Playlist already exists')
	// 				//check for titles
	// 				//@ts-ignore
	// 				playlistURL = `https://www.youtube.com/playlist?list=${playlist.id}`
	// 				const { data: plItems } = await ytClient.playlistItems.list({
	// 					part: ['snippet'],
	// 					//@ts-ignore
	// 					playlistId: playlist.id as string,
	// 					maxResults: 50,
	// 				})
	// 				console.log('Checking for duplicates...')
	// 				for (let i = 0; i < (plItems.items?.length ?? 0); i++) {
	// 					//@ts-ignore
	// 					const item = plItems.items[i]
	// 					const vid = videoIds[i]
	// 					if (!!vid && !!item && (vid !== item.snippet?.resourceId?.videoId)) {
	// 						console.log('Inserting video: ' + vid)
	// 						//@ts-ignore
	// 						await insertVideoOnPlaylist(ytClient, playlist.id, vid)
	// 					} else {
	// 						console.log('Video is already included: ' + vid)
	// 					}
	// 				}
	// 				return res.send('Finished: ' + playlistURL)
	// 			} else {
	// 				console.log('Playlist does not exist, creating...')
	// 				//create
	// 				const plCreated = await ytClient.playlists.insert({
	// 					part: ['snippet', 'contentDetails', 'id', 'status'],
	// 					requestBody: {
	// 						kind: 'youtube#playlist',
	// 						snippet: {
	// 							description: 'Youtubefy is an automated tool that transports your favorite playlists from Spotify over to YouTube.',
	// 							title,
	// 							tags: ['youtubefy', 'music', 'playlist'],
	// 						},
	// 						status: {
	// 							privacyStatus: 'public',
	// 						}
	// 					}
	// 				})
	// 				const plId = plCreated.data.id
	// 				console.log('Playlist created successfully, id: ' + plId)
	// 				//populate - required: snippet.playlistId, snippet.resourceId
	// 				if (plId) {
	// 					playlistURL = `https://www.youtube.com/playlist?list=${plId}`
	// 					for (const vid of videoIds) {
	// 						console.log('Inserting video: ' + vid)
	// 						await insertVideoOnPlaylist(ytClient, plId, vid)
	// 					}
	// 				} else {
	// 					return res.send('Error: Playlist was not created')
	// 				}
	// 			}
	// 			return res.send('Finished: ' + playlistURL)
	// 		} catch (err) {
	// 			console.log(err)
	// 			res.send(err)
	// 		}
	// 	} else {
	// 		return res.status(404).send('Error: Unable to list users playlists')
	// 	}
	// 	res.end('Finishe')
	// })

	app.listen(env.PORT, () => console.log('server running on port ' + env.PORT))

	process.once('SIGINT', async () => {
		console.log('closing browser')
		await browser.close()
	})
	process.once('SIGTERM', async () => {
		console.log('closing browser')
		await browser.close()
	})



	async function scrapePlaylistPage(url: string, sender: Sender): Promise<{ title: string, data: { song: string, artist: string }[] }> {
		await page.goto(url)
		sender.log('Page loaded, waiting for data to load...')
		await wait(seconds(4))
		sender.prog(8)
		const grid = await page.$('div[role="grid"]')
		if (!grid) {
			sender.log('Error: Grid not found')
			throw Error('Grid not found')
		}
		await scrollAll(page)
		const data: { song: string, artist: string }[] = []
		for (let i = 0; i < 10; i++) {
			let namesList = await grid.$$('div[data-encore-id="text"]')
			for (let i = 0; i < namesList.length; i += 3) {
				const song = await namesList[i].evaluate(node => node.innerText)
				const artist = await namesList[i + 1].evaluate(node => node.innerText)
				if (!data.some(x => x?.song === song && x?.artist === artist)) {
					data.push({ song, artist })
				}
			}
			await namesList.at(-1)?.evaluate(node => node.scrollIntoView())
			await wait(500)
		}
		await wait(seconds(4))
		sender.prog(16)
		sender.log('Playlist loaded, parsing names...')
		const playlistNameEl = await page.$('h1[data-encore-id="text"]')
		if (!playlistNameEl) {
			sender.log('Error: Playlist name not found')
			throw Error('Playlist name not found')
		}
		const playlistName = 'Youtubefy - ' + (await playlistNameEl.evaluate(node => node.innerText))
		sender.log(`Playlist name: ${playlistName}`)
		sender.prog(25)
		return {
			title: playlistName,
			data
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
export function atRoute(route: string, host: string): string {
	const env = Env()[0] as EnvObject
	return `${env.NODE_ENV === 'production' ? 'https' : 'http'}://${host}/${route}`
}
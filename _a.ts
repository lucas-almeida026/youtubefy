import { google, youtube_v3 } from 'googleapis'
import Env from './src/env'
import express from 'express'
import path from 'node:path'
import fs from 'node:fs/promises'
import { Command, program } from 'commander'
import { seconds, wait } from './src/timing'
import pup, { Browser, Page } from 'puppeteer'

if (!process.env.APPDATA || typeof process.env.APPDATA !== 'string') {
	console.error('APPDATA is not set')
	process.exit(1)
}

const ytClient = google.youtube('v3')
const DATA_FOLDER_PATH = path.join(process.env.APPDATA, '.youtubefy')
const DATA_FILE_PATH = path.join(DATA_FOLDER_PATH, 'data.json')

program.name('youtubefy')
program.description('Transport your favorite Spotify playlists to YouTube')
program.version('0.0.1')

const test = new Command('test')
test.description('Test')
test.action(async () => {
	const auth = await getAuthObject()
	const response = await ytClient.playlists.list({
		auth,
		part: ['snippet'],
		mine: true,
		maxResults: 40
	})
	if (response) {
		response?.data?.items?.forEach((item) => {
			console.log(item.snippet?.title)
		})
	}
})
program.addCommand(test)

const logout = new Command('logout')
logout.description('Logout')
logout.action(async () => {
	await fs.rm(DATA_FOLDER_PATH, { recursive: true })
	console.log('Logout successful')
	console.log('Please, also remove the app connection from your google account here https://myaccount.google.com/connections')
})
program.addCommand(logout)

const login = new Command('login')
login.description('Login to your google account')
login.action(async () => {
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

	const authClient = new google.auth.OAuth2(
		env.CLIENT_ID,
		env.CLIENT_SECRET,
		'http://localhost:8080/youtube-oauth2-callback'
	)

	const authURL = authClient.generateAuthUrl({
		access_type: 'offline',
		scope: SCOPES
	})

	let server: { close: () => void } | null = null

	app.get('/youtube-oauth2-callback', async (req, res) => {
		const code = req.query.code
		if (!code) {
			res.status(500).send('No code')
			return console.log('Error: no code provided')
		}
		const { tokens } = await authClient.getToken(String(code))
		await fs.writeFile(DATA_FILE_PATH, JSON.stringify(tokens), 'utf-8')
		console.clear()
		res.send('')
		if (server !== null) {
			console.log('Authenticated successfully!')
			server.close()
			return process.exit(0)
		}
	})

	await fs.mkdir(DATA_FOLDER_PATH, { recursive: true })

	server = app.listen(8080, () => {
		console.log('Visit the following URL in your browser to authorize this app:\n', authURL)
	})
	// createFolderStructureIfNotExists(DATA_FOLDER_PATH)
	// 	.then(async () => {
	// 		try {
	// 			const contents = await fs.readFile(DATA_FILE_PATH, 'utf-8')
	// 			return [true, contents] as [boolean, string]
	// 		} catch (e) {
	// 			return [false, ''] as [boolean, string]
	// 		}
	// 	})
	// 	.then(async ([ok, contents]) => {
	// 		if (!ok) {
	// 			server = app.listen(8080, () => {
	// 				console.log('Visit the following URL in your browser to authorize this app:\n', authURL)
	// 			})
	// 			return
	// 		}
	// 		const tokens = JSON.parse(contents)
	// 		if (!tokens) {
	// 			return console.log('Tokens not found')
	// 		}
	// 	})
	// 	.catch(err => {
	// 		console.error(err)
	// 	})
})
program.addCommand(login)

const scrape = new Command('scrape')
scrape.argument('<url>', 'The Spotify playlist URL to scrape')
scrape.description('Scrapes the Spotify playlist page')
scrape.action(async (url) => {
	if (!url || typeof url !== 'string') {
		console.error('Error: No URL provided')
		process.exit(1)
	}
	const urlStart = 'https://open.spotify.com/playlist/'
	if (!url.startsWith(urlStart)) {
		console.error('Error: Invalid URL')
		console.error('\tURL must start with "https://open.spotify.com/playlist/"')
		process.exit(1)
	}
	const playlistURL = url.split('?')[0]
	const browser = await pup.launch({
		headless: true,
		args: ['--no-sandbox', '--window-size=1440,900', '--start-minimized'],
		ignoreDefaultArgs: ['--disable-extensions'],
		// executablePath: '/usr/bin/chromium-browser'
	})
	const page = await browser.newPage()
	console.error('Scraping... (this can take a while)')
	await scrapePlaylistPage(page, playlistURL)
	await browser.close()
	process.exit(0)
})
program.addCommand(scrape)


const getYtIds = new Command('get-yt-ids')
getYtIds.description('Scrape YouTube search results and get Ids for each entry in the data array')
getYtIds.argument('<data>', 'data that is serialized in a custom format')
getYtIds.argument('[parallel]', 'number of parallel requests, defaults to 8', 8)
getYtIds.action(async (data, parallel) => {
	let obj = null
	try {
		obj = customUnmarshal(data)
	} catch (_) {
		console.error('Error: No valid JSON provided')
		process.exit(1)
	}

	if (parallel < 1) {
		parallel = 1
	}

	if (parallel > 32) {
		parallel = 32
	}

	if (!obj) {
		console.error('Error: No valid JSON provided')
		process.exit(1)
	}

	const browser = await pup.launch({
		headless: true,
		args: ['--no-sandbox', '--window-size=1440,900', '--start-minimized'],
		ignoreDefaultArgs: ['--disable-extensions'],
		// executablePath: '/usr/bin/chromium-browser'
	})
	await getVideoIds(browser, obj)
	await browser.close()
	process.exit(0)
})
program.addCommand(getYtIds)

const pushToYt = new Command('push-to-yt')
pushToYt.argument('<data>', 'data that is serialized in a custom format')
pushToYt.action(async (data) => {
	const auth = await getAuthObject()

	let obj = null
	try {
		obj = customUnmarshal(data)
	} catch (_) {
		console.error('Error: No valid JSON provided')
		process.exit(1)
	}

	if (!obj) {
		console.error('Error: No valid JSON provided')
		process.exit(1)
	}

	if (!obj.title || !obj.data || !Array.isArray(obj.data)) {
		console.error('Error: No title or data provided')
		process.exit(1)
	}

	const { data: playlists } = await ytClient.playlists.list({
		auth,
		part: ['id', 'snippet'],
		mine: true,
	})

	if (!playlists?.items || !playlists?.items?.length) {
		console.error('Error: No playlists found')
		process.exit(1)
	}
	let targetPlaylist: youtube_v3.Schema$Playlist | null = null
	for (const p of playlists.items) {
		if (p.snippet?.title === obj.title) {
			targetPlaylist = p
		}
	}
	if (targetPlaylist === null) {
		const { data: p } = await ytClient.playlists.insert({
			auth,
			part: ['snippet', 'contentDetails', 'id', 'status'],
			requestBody: {
				kind: 'youtube#playlist',
				snippet: {
					description: 'Youtubefy is an automated tool that transports your favorite playlists from Spotify over to YouTube.',
					title: obj.title,
					tags: ['youtubefy', 'music', 'playlist'],
				},
				status: {
					privacyStatus: 'public',
				}
			}
		})
		targetPlaylist = p
	}
	fs.writeFile('targetPlaylist.json', JSON.stringify(targetPlaylist, null, 2))
	const currentVideoIds: string[] = []
	if (targetPlaylist.id) {
		const {data: vids} = await ytClient.playlistItems.list({
			auth,
			part: ['snippet'],
			playlistId: targetPlaylist.id,
			maxResults: 100,
		})
		for (const v of vids.items ?? []) {
			if (v.snippet?.resourceId?.videoId) {
				currentVideoIds.push(v.snippet.resourceId.videoId)
			}
		}
	}
	for (const d of obj.data) {
		if (!d.id || typeof d.id !== 'string') {
			console.error('Error: No id provided')
			process.exit(1)
		}
		if (currentVideoIds.includes(d.id)) {
			continue
		}
		console.error('Adding video:', d.id)
		await ytClient.playlistItems.insert({
			auth,
			part: ['snippet'],
			requestBody: {
				snippet: {
					playlistId: targetPlaylist.id,
					resourceId: {
						kind: 'youtube#video',
						videoId: d.id,
					}
				}
			}
		})
	}
	const playlistURL = `https://www.youtube.com/playlist?list=${targetPlaylist.id}`
	console.error('Done! Playlist URL:', playlistURL)
})
program.addCommand(pushToYt)
program.parse()

function isLoggedIn(contents: string) {
	if (!contents) return false
	const data = JSON.parse(contents)
	if (!data) return false
	if (!data['access_token']) return false
	return true
}

async function getAuthObject() {
	try {
		const contents = await fs.readFile(DATA_FILE_PATH, 'utf-8')
		if (!isLoggedIn(contents)) {
			console.log('Error: You are not authenticated')
			console.log('\trun `youtubefy login` to authenticate')
			console.log('\trun `youtubefy login --help` for more information')
			process.exit(1)
		}
		const tokens = JSON.parse(contents)
		const authClient = new google.auth.OAuth2()
		authClient.setCredentials(tokens)
		return authClient
	} catch (_) {
		console.log('Error: Could not verify authentication')
		console.log('\trun `youtubefy login` to authenticate')
		console.log('\trun `youtubefy login --help` for more information')
		process.exit(1)
	}
}


async function createFolderStructureIfNotExists(p: string) {
	try {
		await fs.access(p)
	} catch (err) {
		await fs.mkdir(p, { recursive: true })
	}
}

async function scrapePlaylistPage(page: Page, url: string) {
	await page.goto(url)
	console.error('Page loaded, waiting for data to load...')
	await wait(seconds(4))
	// sender.prog(8)
	const grid = await page.$('div[role="grid"]')
	if (!grid) {
		// sender.log('Error: Grid not found')
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
				data.push({
					song: song.replace(/[^a-zA-Z0-9_ -]/g, '-'),
					artist: artist.replace(/[^a-zA-Z0-9_ -]/g, '-')
				})
			}
		}
		await namesList.at(-1)?.evaluate(node => node.scrollIntoView())
		await wait(500)
	}
	await wait(seconds(4))
	// sender.prog(16)
	console.error('Playlist loaded, parsing names...')
	const playlistNameEl = await page.$('h1[data-encore-id="text"]')
	if (!playlistNameEl) {
		console.error('Error: Playlist name not found')
		throw Error('Playlist name not found')
	}
	const playlistName = 'Youtubefy - ' + (await playlistNameEl.evaluate(node => node.innerText))
	console.error(`Playlist name: ${playlistName}`)
	// sender.prog(25)
	console.log(customMarshal({
		title: playlistName,
		data
	}))
	// return {
	// 	title: playlistName,
	// 	data
	// }
}

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

async function getVideoIds(browser: Browser, data: {
	title: string,
	data: {song: string, artist: string}[]
}, parallel = 8) {
	// const page = await browser.newPage()
	const pages = await Promise.all(
		Array(parallel).fill(0).map(() => browser.newPage())
	)
	const videoIds: {song: string, artist: string, id: string}[] = []
	const finalArr: any[] = []
	for (let i = 0; i < data.data.length; i += parallel) {
		const chunks = data.data.slice(i, i + parallel)
		// const searches = chunks.map(({song, artist}) => [...artist.split(' '), ...song.split(' '), 'lyrics'].map(e => encodeURIComponent(e)).join('+'))
		const res = await Promise.all(pages.map(async (page, i) => {
			// await page.goto(searches[i])
			if (!chunks[i]) {
				return
			}
			const { song, artist } = chunks[i]
			const search = [...artist.split(' '), ...song.split(' '), 'lyrics'].map(e => encodeURIComponent(e)).join('+')
			const url = `https://www.youtube.com/results?search_query=${search}`
			console.error(`Searching for ${song} - ${artist} video`)
			await page.goto(url)
			await wait(seconds(2))
			console.error('Scraping video id from ' + search)
			const titleEls = (await page.$$('a.yt-simple-endpoint.style-scope.ytd-video-renderer')).slice(0, 3)
			const hrefs = await Promise.all(titleEls.map(e => e.evaluate(node => node.getAttribute('href'))))
			let videoId = ''
			for (const h of hrefs) {
				if (h) {
					const [, query] = h.split('?')
					const params = new URLSearchParams(query)
					const v = params.get('v')
					if (v && !videoId) {
						videoId = v
					}
				}
			}
			return {
				song,
				artist,
				id: videoId
			}
		}))
		finalArr.push(...res.filter(x => !!x && !!x?.id))
	}
	console.log(customMarshal({
		title: data.title,
		data: finalArr
	}))
}

function customMarshal(obj: { title: string, data: any[] }): string {
	let buffer = `title:${obj.title};`
	for (let i = 0; i < obj.data.length; i++) {
		const entries = Object.entries(obj.data[i])
		for (const [k, v] of entries) {
			buffer += `${k}:${v},`
		}
		if (i !== obj.data.length - 1) {
			buffer += ';'
		}
	}
	return buffer
}

function customUnmarshal(str: string): { title: string, data: any[] } {
	try {
		let lines = str.split(';')
		const titleLine = lines[0]
		const title = titleLine.split(':')[1]
		const data: any[] = []
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i]
			const entries = line.split(',')
			let obj: any = {}
			for (const entry of entries.slice(0, -1)) {
				const [k, v] = entry.split(':')
				obj[k] = v
			}
			data.push(obj)
		}
		return {
			title,
			data
		}
	} catch (_) {
		throw Error('Invalid playlist format')
	}
}
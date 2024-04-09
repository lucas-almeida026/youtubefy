import { Browser } from 'puppeteer'
import { seconds, wait } from './timing'
import { youtube_v3 } from 'googleapis'
import { GaxiosPromise } from 'googleapis/build/src/apis/abusiveexperiencereport'

export async function getVideoIds(browser: Browser, pairs: string[][]) {
	const page = await browser.newPage()
	const videoIds: string[] = []
	for (const [title, author] of pairs) {
		let videoId = ''
		const searchQuery = [...author.split(' '), ...title.split(' '), 'lyrics'].map(e => encodeURIComponent(e)).join('+')
		await page.goto(`https://www.youtube.com/results?search_query=${searchQuery}`)
		await wait(seconds(2))
		const titleEls = (await page.$$('a.yt-simple-endpoint.style-scope.ytd-video-renderer')).slice(0, 3)
		const hrefs = await Promise.all(titleEls.map(e => e.evaluate(node => node.getAttribute('href'))))
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
		videoIds.push(videoId)
	}
	return videoIds
}

export function insertVideoOnPlaylist(ytClient: youtube_v3.Youtube, playlistId: string, videoId: string): GaxiosPromise<youtube_v3.Schema$PlaylistItem> {
	return ytClient.playlistItems.insert({
		part: ['snippet'],
		requestBody: {
			snippet: {
				playlistId,
				resourceId: {
					kind: 'youtube#video',
					videoId,
				}
			}
		}
	})
}

export async function getVideoIds2(ytClient: youtube_v3.Youtube, pairs: string[][],) {
	// const page = await browser.newPage()
	const videoIds: any[] = []
	for (const [title, author] of pairs) {
		let videoId
		const res = await ytClient.search.list({
			q: `${author} ${title} lyrics`,
			part: ['snippet', 'id'],
			maxResults: 1,
		})
		if (res?.data?.items) {
			const [first] = res.data.items
			if (first && first.id?.videoId) {
				videoId = first.id
			}
		}
		videoIds.push(videoId || null)
	}
	return videoIds
}
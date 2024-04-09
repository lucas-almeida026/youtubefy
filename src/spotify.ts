import { Browser, Page } from 'puppeteer'
import { seconds, wait } from './timing'

const SPOTIFY_USER = 'refit99703@nimadir.com'
const SPOTIFY_PASSWORD = 'Aa!1asdf1234'

export async function spotifyLogin(browser: Browser, page: Page): Promise<NodeJS.Timeout> {
	const interval = setInterval(async () => {
		if (browser.connected) {
			const dismissBtn = await page.$('button[data-encore-id="buttonSecondary"')
			if (!dismissBtn) return
			const text = await dismissBtn.evaluate(node => node.innerText)
			if (text.toLowerCase() === 'dismiss') await dismissBtn.click()
		}
	}, 5000)
	await page.goto('https://open.spotify.com/')
	console.log('Entering spotify page...')
	const loginBtn = await page.$('button[data-testid="login-button"]')
	if (!loginBtn) {
		console.log('Error: Login button not found')
		process.exit(1)
	}
	await loginBtn.click()
	await wait(seconds(2))
	await page.waitForSelector('div[data-testid="login-form"]')
	const userInput = await page.$('input[data-testid="login-username"]')
	const passwordInput = await page.$('input[data-testid="login-password"]')
	if (!userInput || !passwordInput) {
		console.log('Error: Username or password input not found')
		process.exit(1)
	}
	await wait(seconds(2))
	console.log('Logging in...')
	await userInput.type(SPOTIFY_USER)
	await passwordInput.type(SPOTIFY_PASSWORD)
	await wait(seconds(2))
	const loginBtnSubmit = await page.$('button#login-button')
	if (!loginBtnSubmit) {
		console.log('Error: Login button not found')
		process.exit(1)
	}
	console.log('Waiting for authentication...')
	await loginBtnSubmit.click()
	console.log('Sussessfully logged in!')
	await wait(seconds(3))
	return interval
}
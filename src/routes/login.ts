import { Request, Response } from 'express'
import { preventThrow } from '../return'
import { SymmetricCrypto } from '../cookie'
import { google, Auth, gmail_v1 } from 'googleapis'
import AdminModel from '../models/admin'
import serverState, { STR_NOT_SET } from '../state'
import { TemplateRenderer } from '../templates'
import { Accessor } from '../cache'
import crypto from 'node:crypto'
import { minutes } from '../timing'
import UserModel, { UserDoNotExist } from '../models/user'
import { SessionCreated, SessionModelOk } from '../models/session'
import { atRoute } from '../main'


const after_script = `
<script>
const form = document.querySelector('form')
const emailInput = document.querySelector('input#email')
const formBtn = document.querySelector('button[type="submit"]')
if (form && emailInput) {
	form.addEventListener('submit', (e) => {
		e.preventDefault()
		if (formBtn) {
			formBtn.disabled = true
			formBtn.textContent = 'Sending...'
		}
		fetch('/login', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				email: emailInput.value.trim().toLowerCase()
			})
		})
		.then(res => res.json())
		.then(res => {
			if (res.code >= 400) {
				if (res.code === 429) {
					alert('You did too many login attempts, try again later!')
					return window.location.href = '/'
				}
				alert(res?.message ?? "Unexpected error")
			}
			alert(\`An email has been sent to "\${emailInput.value}", clink on the Login button \`)
			emailInput.value = ''
		})
		.catch(err => {
			alert('Failed to make request')
		})
		.finally(() => {
			if (formBtn) {
				formBtn.disabled = false
				formBtn.textContent = 'Send'
			}
		})
	})
} else {
	alert('Form not found')
}
</script>
`

export function LoginGET(cookieCrypt: SymmetricCrypto, renderer: TemplateRenderer, loginCodesCache: Accessor<[string, number]>, userModel: ReturnType<typeof UserModel>, sessionModel: SessionModelOk, tailwind_style_tag: string, htmx_script_tag: string) {
	return {
		path: '/login',
		handler: async (req: Request, res: Response) => {
			const { code } = req.query
			if (code) {
				const [decoded, err] = await preventThrow(() => decodeURIComponent(String(code)))
				if (err !== null) {
					return res.status(500).send('Internal server error; unable to decode login code')
				}
				const [data, err2] = loginCodesCache.get(decoded)
				if (err2 !== null) {
					return res.status(404).send('Login code not found')
				}
				const [email, timestamp] = data
				if (Date.now() > timestamp + minutes(3)) {
					return res.status(401).send('Login code expired')
				}
				//more info
				const userAgent = String(req.get('User-Agent') ?? 'unknown')
				const ip = req.ip ?? 'unknown'
				loginCodesCache.unset(decoded)
				
				let [user, err3] = await userModel.getIfExists(email)

				if (err3 !== null && !(err3 instanceof UserDoNotExist)) {
					return res.status(500).send('Internal server error; unable to check if user exists\n'+err3?.message)
				}
				if (err3 instanceof UserDoNotExist) {
					const [userCreated, err4] = await userModel.create(email, JSON.stringify({
						ip,
						user_agent: userAgent
					}))
					if (err4 !== null) {
						return res.status(500).send('Internal server error; unable to create user\n'+err4?.message)
					}
					user = userCreated
				}
				if (user === null) {
					return res.status(500).send('Internal server error; unable to get user\n')
				}
				const [session, err5] = await sessionModel.create({
					email,
					uuid: user.uuid,
				})
				if (err5 !== null) {
					return res.status(500).send('Internal server error; unable to create session\n'+err5)
				}
				const [cookie, err6] = await cookieCrypt.encrypt(JSON.stringify(session), 'utf-8', 'base64')
				if (err6 !== null) {
					return res.status(500).send('Internal server error; unable to encrypt session\n'+err6)
				}
				res.cookie('session', cookie, {
					httpOnly: true,
					expires: new Date(session.expiresAt_ms)
				})
				return res.redirect('/app')
			
			} else {
				const {session} = req.cookies
				if (session) {
					const [decoded] = await cookieCrypt.decrypt(session, 'base64', 'utf-8')
					if (decoded !== null) {
						const [sessionObj, err] = await preventThrow(() => JSON.parse(decoded) as SessionCreated)
						if (err !== null) {
							console.log('unable to parse session', err)
						}
						if (sessionObj) {
							const [verified, err2] = await sessionModel.verify(sessionObj)
							if (err2 !== null) {
								console.log('unable to verify session', err2)
							}
							if (verified) {
								return res.redirect('/app')
							}
						}
					}
				}
				return res.send(renderer.page('base', 'login').renderOrDefault(
					{tailwind_style_tag, htmx_script_tag, after_script},
					{}
				))
			}
		}
	}
}

export function LoginPOST(gmailClient: gmail_v1.Gmail, renderer: TemplateRenderer, loginCodesCache: Accessor<[string, number]>) {
	const trustedProviders = [
		'gmail.com',
		'outlook.com',
		'protonmail.com',
		'yahoo.com',
		'aol.com',
		'hotmail.com',
		'icloud.com',
		'yandex.com',
		'zoho.com',
	]
	return {
		path: '/login',
		handler: async (req: Request, res: Response) => {
			const { email } = req.body
			if (!email || typeof email !== 'string') {
				return res.status(422).send({ error: 'Expecting email value' })
			}
			if (email.length < 3 || email.length > 255) {
				return res.status(422).send({ error: 'Invalid email value' })
			}
			if (!email.includes('@')) {
				return res.status(422).send({ error: 'Invalid email value' })
			}
			const sanitizedEmail = email.replace(/[^a-zA-Z0-9@.-_]/g, '')
			if (!trustedProviders.some(ending => sanitizedEmail.endsWith(ending))) {
				return res.status(422).send({ error: `No support; We do not support the "${sanitizedEmail.split('@')?.[1] ?? '<unknown>'}" email provider` })
			}
			const [code, err2] = await preventThrow(() => crypto.randomBytes(32).toString('hex'))
			if (err2 !== null) {
				return res.status(500).send({ error: 'Failed to generate code' })
			}
			const msNow = Date.now()
			const [, err3] = loginCodesCache.set(code, [sanitizedEmail, msNow])
			if (err3 !== null) {
				return res.status(500).send({ error: 'Failed to save code' })
			}
			const emailLines = [
				'From: autoplaylists.app@gmail.com',
				'To: ' + sanitizedEmail,
				'Content-Type: text/html; charset=utf-8',
				'MIME-Version: 1.0',
				'Subject: Youtubefy - Login with Magic Link',
				'',
				renderer
					.layout('magic-link')
					.renderOrDefault({
						link: atRoute('login?code=' + encodeURIComponent(code), String(req.get('host'))),
					})
			]
			const encodedEmail = Buffer.from(emailLines.join('\n'))
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
			const [, err] = await preventThrow(gmailClient.users.messages.send({
				userId: 'me',
				requestBody: {
					raw: encodedEmail
				},
			}))
			if (err !== null) {
				return res.status(500).send({ error: 'Failed to deliver email' })
			}
			return res.send({ ok: true })
		}
	}
}

// TODO: move to other place later
interface ParsedUserAgent {
    standard: {
        name: string;
        version: string;
    };
    os: {
        name: string;
        version: string;
    };
    browser: {
        name: string;
        version: string;
    };
    engine: {
        name: string;
        version: string;
    };
    platform: string;
    renderingEngines: {
        name: string;
        version: string;
    }[];
}

// function parseUserAgent(userAgent: string): ParsedUserAgent {
//     const parsed: ParsedUserAgent = {
//         standard: { name: '', version: '' },
//         os: { name: '', version: '' },
//         browser: { name: '', version: '' },
//         engine: { name: '', version: '' },
//         platform: '',
//         renderingEngines: []
//     };

//     const pieces = userAgent.split(/\s+/).map(p => p.toLowerCase().trim());

// 	for (const p of pieces) {
// 		if (p.includes('/')) {
// 			const [name, version] = p.split('/');
// 			//weir checking login
// 		} else if (p.startsWith('(') && p.endsWith(')')) {
// 			const subparts = p.slice(1, -1).split(/(,|;)/).map(p => p.trim());
// 			//weir checking login
// 		} else {
// 			console.log(`Unable to process user agent part "${p}"`)
// 		}
// 	}
    
//     // Parse standard browser information
// 	const [name, version] = ua[0].split('/');
//     parsed.standard.name = name;
//     parsed.standard.version = version

//     // Parse OS information
//     parsed.os.name = ua.find(part => part.includes('('))?.split(';')[0].split('(')[1] || '';
//     parsed.os.version = ua.find(part => part.includes('Windows NT'))?.split('Windows NT ')[1]?.split(';')[0] || '';

//     // Parse browser information
//     parsed.browser.name = ua.find(part => part.includes('Chrome'))?.split('Chrome/')[0] || '';
//     parsed.browser.version = ua.find(part => part.includes('Chrome'))?.split('Chrome/')[1]?.split(' ')[0] || '';

//     // Parse engine information
//     parsed.engine.name = ua.find(part => part.includes('AppleWebKit'))?.split('/')[0] || '';
//     parsed.engine.version = ua.find(part => part.includes('AppleWebKit'))?.split('AppleWebKit/')[1]?.split(' ')[0] || '';

//     // Parse platform information
//     parsed.platform = ua.find(part => part.includes('Win64') || part.includes('x86_64')) ? 'x64' : '';

//     // Parse rendering engines
//     const safariVersion = ua.find(part => part.includes('Version/'));
//     if (safariVersion) {
//         parsed.renderingEngines.push({
//             name: 'Safari',
//             version: safariVersion.split('Version/')[1].split(' ')[0]
//         });
//     }

//     return parsed;
// }
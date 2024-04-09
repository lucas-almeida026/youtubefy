import { Request, Response } from 'express'
import { preventThrow } from '../return'
import { SymmetricCrypto } from '../cookie'
import { google, Auth, gmail_v1 } from 'googleapis'
import AdminModel from '../models/admin'
import serverState, { STR_NOT_SET } from '../state'

export default function YoutubeOauth2CallbackGET(cookieCrypt: SymmetricCrypto, authClient: Auth.OAuth2Client, gmailClient: gmail_v1.Gmail, adminModel: ReturnType<typeof AdminModel>) {
	return {
		path: '/youtube-oauth2-callback',
		handler: async (req: Request, res: Response) => {
			const { code } = req.query
			const { user_id } = req.cookies
			if (!user_id || typeof user_id !== 'string') return res.status(401).send("You don't have the necessary permissions to access this resource")
			if (!code) res.status(400).send('Expecting code but found nothing')
			const [ADMIN_USER_ID, err0] = serverState.get('ADMIN_USER_ID')
			console.log(ADMIN_USER_ID)
			if (err0 !== null) {
				return res.status(500).send('Internal server error; unable to get ADMIN_USER_ID')
			}
			if (ADMIN_USER_ID === STR_NOT_SET) {
				return res.status(500).send('Internal server error; unable to get ADMIN_USER_ID')
			}
			const [cookieData, err] = await cookieCrypt.decrypt(user_id)
			if (err !== null) {
				return res.status(500).send('Internal server error; unable to decrypt session ID')
			}
			if (!cookieData) return res.status(401).send("You don't have the necessary permissions to access this resource")
			if (cookieData !== ADMIN_USER_ID || '') return res.status(401).send("You don't have the necessary permissions to access this resource")
			const [tokensRes, err3] = await preventThrow(authClient.getToken(code as string))
			if (err3 !== null) {
				return res.status(500).send('Error getting tokens')
			}
			const { tokens } = tokensRes
			authClient.setCredentials(tokens)
			google.options({ auth: authClient })
			res.clearCookie('user_id')
			if (!!tokens.refresh_token) {
				const [response, err] = await preventThrow(gmailClient.users.getProfile({ userId: 'me' }))
				if (err !== null) {
					return res.status(500).send('Error getting user profile')
				}
				const emailAddr = response.data.emailAddress
				if (!emailAddr) {
					return res.status(500).send('Error getting user profile')
				}
				const [, err2] = await preventThrow(adminModel.save({
					email: emailAddr,
					token: tokens.refresh_token
				}))
				if (err2 !== null) {
					return res.status(500).send('Error starting admin session')
				}
			} else {
				return res.status(422).send('No refresh token found')
			}
			res.redirect('/')
		}
	}
}
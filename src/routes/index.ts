import { Router } from 'express';
import YoutubeOauth2CallbackGET from './youtube-oauth2-callback';
import serverState from '../state';
import { SymmetricCrypto } from '../cookie'
import { Auth, gmail_v1 } from 'googleapis'
import AdminModel from '../models/admin'
import { LoginGET, LoginPOST } from './login'
import { TemplateRenderer } from '../templates'
import { maybeServerIsNotReady } from '../middlewares'
import { RateLimitRequestHandler } from 'express-rate-limit'
import MemCache from '../cache'
import UserModel from '../models/user'
import { SessionModelOk } from '../models/session'

const loginCodeCache = MemCache<Record<string, [string, number]>>({})
const routes = Router();

type RoutesParams = {
	cookieCrypt: SymmetricCrypto,
	authClient: Auth.OAuth2Client,
	gmailClient: gmail_v1.Gmail,
	adminModel: ReturnType<typeof AdminModel>
	userModel: ReturnType<typeof UserModel>,
	sessionModel: SessionModelOk,
	renderer: TemplateRenderer,
	tailwind_style_tag: string,
	htmx_script_tag: string,
	loginMagicLinkLimiter: RateLimitRequestHandler,
	generalLoginLimiter: RateLimitRequestHandler,
}
export default function Routes(p: RoutesParams) {
	const youtuebCallbackRoute = YoutubeOauth2CallbackGET(
		p.cookieCrypt,
		p.authClient, 
		p.gmailClient,
		p.adminModel
	)
	const loginGET = LoginGET(
		p.cookieCrypt,
		p.renderer,
		loginCodeCache,
		p.userModel,
		p.sessionModel,
		p.tailwind_style_tag,
		p.htmx_script_tag
	)
	const loginPOST = LoginPOST(
		p.gmailClient,
		p.renderer,
		loginCodeCache
	)

	routes.get(youtuebCallbackRoute.path, youtuebCallbackRoute.handler)
	routes.get(
		loginGET.path,
		maybeServerIsNotReady(
			p.adminModel.isSetUp,
			p.renderer.page('base', 'notReady').renderOrDefault({tailwind_style_tag: p.tailwind_style_tag}, {})
		),
		loginGET.handler
	)
	routes.post(loginPOST.path, p.loginMagicLinkLimiter, loginPOST.handler)
	return routes
}
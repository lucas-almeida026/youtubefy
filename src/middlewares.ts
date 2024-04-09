import { NextFunction, Request, Response } from 'express'
import { ValueOrError } from './types'

export const maybeServerIsNotReady = (
	predicate: () => ValueOrError<boolean> | Promise<ValueOrError<boolean>>,
	notReadyContents: string
) => async (_: Request, res: Response, next: NextFunction) => {
	const [isReady, err] = await predicate()
	if (err !== null) {
		return res.status(500).send('Internal server error')
	}
	if (!isReady) {
		return res.send(notReadyContents)
	}
	next()
}
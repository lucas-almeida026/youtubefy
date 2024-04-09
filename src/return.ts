import { ValueOrError } from './types'

export default function valueOrError<T>(x: T | Error, _default?: T): ValueOrError<T> {
	const res = Array(2).fill(null)
	if (x instanceof Error) {
		res[1] = x
		if (_default !== undefined) {
			res[0] = _default
		}
	} else {
		res[0] = x
	} 
	return res as ValueOrError<T>
}

export async function preventThrow<T>(asyncValue: (() => T | Promise<T>) | Promise<T>, _default?: T): Promise<ValueOrError<T>> {
	try {
		const res = await (asyncValue instanceof Promise ? asyncValue : asyncValue())
		return valueOrError(res)
	} catch(err) {
		return valueOrError(err, _default) as ValueOrError<T>
	}
}

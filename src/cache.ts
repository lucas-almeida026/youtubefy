import valueOrError from './return'
import { ValueOrError } from './types'

type CacheOptions = {
	preventRewrites?: boolean
}
const defaultOptions: CacheOptions = {
	preventRewrites: false
}

export interface Accessor<T> {
	set(key: string, val: T): ValueOrError<T>,
	get(key: string): ValueOrError<T>,
	unset(key: string): void
}

export default function MemCache<T, V = T extends object ? T[keyof T] : T>(
	prev: Record<string, V>,
	options = defaultOptions
): Accessor<V> {
	const data: Record<string, V> = prev
	return {
		set(key: string, val: V): ValueOrError<V> {
			if (options.preventRewrites && data[key] !== undefined) {
				return valueOrError<V>(new Error('Key already exists'))
			}
			data[key] = val
			return valueOrError<V>(val)
		},
		get(key: string): ValueOrError<V> {
			return valueOrError<V>(data[key] ?? new Error('Key not found'))
		},
		unset(key: string): void {
			delete data[key]
		}
	}
}
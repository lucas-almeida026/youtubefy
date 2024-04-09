export function dateFromMs(ms: number) {
	return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}
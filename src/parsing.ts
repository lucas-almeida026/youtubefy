export function parseMultilineRSAKey(key: string) {
	if (key.length === 0 || !(key.includes(';'))) return null
	const lines = key.split(';')
	return lines.join('\n')
}
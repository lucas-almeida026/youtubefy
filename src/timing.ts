export function wait(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

export function seconds(s: number) {
	return s * 1000
}

export function minutes(m: number) {
	return seconds(m * 60)
}

export function hours(h: number) {
	return minutes(h * 60)
}
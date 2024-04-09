export default function Mutex() {
	let locked = false
	const waitingQueue: Array<() => void> = []
	return {
		lock: async () => {
			return new Promise<void>((resolve) => {
				if (!locked) {
					locked = true
					resolve()
				} else {
					waitingQueue.push(resolve)
				}
			})
		},
		unlock: () => {
			if (waitingQueue.length > 0) {
				const next = waitingQueue.shift()
				if (next) {
					next()
				}
			} else {
				locked = false
			}
		}
	}
}
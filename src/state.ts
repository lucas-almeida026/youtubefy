import MemCache from './cache'

export const STR_NOT_SET = '<not set>'

const serverState = MemCache({
	isSetUp: false,
	ADMIN_USER_ID: STR_NOT_SET
})

export default serverState
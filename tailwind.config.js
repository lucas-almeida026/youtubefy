/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ['./src/templates/**/*.{html,js}'],
	theme: {
		screens: {
			tv: '2048px',
			xxl: '1440px',
			xl: '1280px',
			lg: '1024px',
			md: '768px',
			sm: '640px',
			xs: '480px',
			xxs: '300px',
			mn: '0px'
		},
		extend: {
			colors: {
				ad_orange: '#ff7809',
				ad_purple: '#56068d'
			}
		}
	},
	plugins: [],
}
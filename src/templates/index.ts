import fs from 'node:fs/promises'
import dot, { RenderFunction } from 'dot'

dot.templateSettings.strip = false //preserve newlines in template

type SecureLayoutRenderer = {
	renderOrDefault: (data: Record<string, unknown>, defaultValue?: string) => string
}

type SecurePageRenderer = {
	renderOrDefault: (layoutData: Record<string, unknown>, pageData: Record<string, unknown>, defaultValue?: string) => string
}

export default async function createRenderer$(templatesPath: string, globalDefaultValue: string) {
	try {
		const layoutInodes = await fs.readdir(`${templatesPath}/layouts`)
		const layoutFilenames = await Promise.all(
			layoutInodes
				.filter(
					async node => (await fs.stat(`${templatesPath}/layouts/${node}`)).isFile()
				)
		)
		const rederFunctionMap: Record<string, RenderFunction> = {}
		for (let i = 0; i < layoutFilenames.length; i++) {
			const layoutFilename = layoutFilenames[i]
			const layoutName = layoutFilename.split('.').slice(0, -1).join('.')
			const layoutPath = `${templatesPath}/layouts/${layoutFilename}`
			const renderFn = dot.template(await fs.readFile(layoutPath, 'utf-8'))
			rederFunctionMap[layoutName] = renderFn
		}

		const pageInodes = await fs.readdir(`${templatesPath}/pages`)
		const pageFilenames = await Promise.all(
			pageInodes
				.filter(
					async node => (await fs.stat(`${templatesPath}/pages/${node}`)).isFile()
				)
		)
		for (let i = 0; i < pageFilenames.length; i++) {
			const pageFilename = pageFilenames[i]
			const pageName = pageFilename.split('.').slice(0, -1).join('.')
			const pagePath = `${templatesPath}/pages/${pageFilename}`
			const renderFn = dot.template(await fs.readFile(pagePath, 'utf-8'))
			rederFunctionMap[pageName] = renderFn
		}
		return {
			layout: (layoutName: string): SecureLayoutRenderer => {
				const mayberRenderFn = rederFunctionMap[layoutName]
				if (!mayberRenderFn) {
					return {
						renderOrDefault: (_, defaultvalue) => defaultvalue ?? globalDefaultValue,
					}
				}
				return {
					renderOrDefault: (data) => {
						return mayberRenderFn(data)
					},
				}
			},
			page: (layoutName: string, pageName: string): SecurePageRenderer => {
				const maybeLayoutRenderFn = rederFunctionMap[layoutName]
				if (!maybeLayoutRenderFn) {
					return {
						renderOrDefault: (_, __, defaultvalue) => defaultvalue ?? globalDefaultValue,
					}
				}
				const maybePageRenderFn = rederFunctionMap[pageName]
				if (!maybePageRenderFn) {
					return {
						renderOrDefault: (_, __, defaultvalue) => defaultvalue ?? globalDefaultValue,
					}
				}
				return {
					renderOrDefault: (layoutData, pageData) => {
						if ('outlet' in layoutData) {
							console.warn('The `outlet` property is reserved. It will be overwritten.')
						}
						return maybeLayoutRenderFn({
							...layoutData,
							outlet: maybePageRenderFn(pageData)
						})
					},
				}
			}
		}
	} catch (err) {
		throw err
	}
}

type Awaited<T> = T extends PromiseLike<infer U> ? U : T;
export type TemplateRenderer = Awaited<ReturnType<typeof createRenderer$>>
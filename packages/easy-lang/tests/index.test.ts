import { createI18nTool } from '../src/index';
import Transform from './translation.json'
import { beforeAll, test, expect } from 'vitest'

beforeAll(() => {
  // mock localStorage
  global.localStorage = {
    store: {} as Record<string, string>,
    getItem(key: string) { return this.store[key] || null },
    setItem(key: string, value: string) { this.store[key] = value },
    removeItem(key: string) { delete this.store[key] },
    clear() { this.store = {} },
  } as any
})

test('i18nTool $t should translate', () => {
  const i18nTool = createI18nTool<typeof Transform, 'en' | 'zh'>({
    defaultLang: 'en',
    langs: ['en', 'zh'],
    translations: Transform,
  });
  expect(i18nTool.$t('错误')).toBe(Transform['错误']['en'])
}) 
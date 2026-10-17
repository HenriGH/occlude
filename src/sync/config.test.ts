import { describe, expect, it } from 'vitest'
import { publicConfiguration } from './config'

describe('public browser configuration', () => {
  it('supports local-only mode and a public HTTPS Supabase project', () => {
    expect(publicConfiguration()).toBeNull()
    expect(publicConfiguration('https://example.supabase.co', 'sb_publishable_test')).toEqual({ url: 'https://example.supabase.co', key: 'sb_publishable_test' })
  })
  it('rejects incomplete configuration, secret keys, credentials in URLs and non-HTTPS origins', () => {
    expect(() => publicConfiguration('https://example.supabase.co')).toThrow()
    expect(() => publicConfiguration('https://example.supabase.co', 'sb_secret_test')).toThrow(/öffentlichen/)
    for (const url of ['http://example.supabase.co', 'https://user:pass@example.supabase.co', 'https://example.supabase.co/path', 'https://example.supabase.co?token=anything']) expect(() => publicConfiguration(url, 'sb_publishable_test')).toThrow()
  })
})

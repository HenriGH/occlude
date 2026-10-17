export function publicConfiguration(url?: string, key?: string) {
  if (!url && !key) return null
  if (!url || !key) throw new Error('Bitte Supabase-URL und Publishable Key konfigurieren.')
  if (!key.startsWith('sb_publishable_')) throw new Error('Nur einen öffentlichen Supabase Publishable Key verwenden; niemals einen Secret Key.')
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash)
    throw new Error('Die Supabase-URL muss eine reine HTTPS-Projektadresse sein.')
  return { url: parsed.origin, key }
}

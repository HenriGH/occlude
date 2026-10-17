import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmailSignIn } from './EmailSignIn'
import { mailCooldownKey } from '../sync/authFeedback'

const project = 'https://example.supabase.co'
function setup() {
  const auth = {
    signInWithOtp: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
  }
  const rendered = render(<EmailSignIn auth={auth} projectUrl={project} />)
  return { auth, ...rendered, user: userEvent.setup() }
}
beforeEach(() => localStorage.clear())
describe('email sign-in recovery', () => {
  it('requests once with the current origin and preserves a send pause across a remount and email change', async () => {
    const { auth, user, unmount } = setup()
    await user.type(screen.getByRole('textbox', { name: 'E-Mail-Adresse' }), 'student@example.test')
    await user.click(screen.getByRole('button', { name: 'Anmelde-E-Mail senden' }))
    expect(auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({ email: 'student@example.test', options: { emailRedirectTo: new URL('/', location.origin).href } })
    expect(screen.getByRole('button', { name: /Erneut anfragen/ })).toBeDisabled()
    unmount()
    const next = setup()
    await next.user.type(screen.getByRole('textbox', { name: 'E-Mail-Adresse' }), 'other@example.test')
    expect(screen.getByRole('button', { name: /Erneut anfragen/ })).toBeDisabled()
    fireEvent.submit(screen.getByRole('textbox', { name: 'E-Mail-Adresse' }).closest('form')!)
    expect(next.auth.signInWithOtp).not.toHaveBeenCalled()
  })
  it('explains a project-wide email limit and still accepts an already delivered code without resending', async () => {
    const { auth, user } = setup()
    auth.signInWithOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'over_email_send_rate_limit', status: 429 } })
    await user.type(screen.getByRole('textbox', { name: 'E-Mail-Adresse' }), 'student@example.test')
    await user.click(screen.getByRole('button', { name: 'Anmelde-E-Mail senden' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Versandlimit des Projekts')
    await user.type(screen.getByRole('textbox', { name: 'Code aus der E-Mail' }), '123456')
    await user.click(screen.getByRole('button', { name: 'Mit Code anmelden' }))
    expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({ email: 'student@example.test', token: '123456', type: 'email' })
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Anmeldung erfolgreich')
    expect(Object.values(localStorage).join('')).not.toContain('123456')
  })
  it('prevents duplicate submits while a send request is in flight', async () => {
    const { auth, user } = setup()
    let finish!: () => void
    auth.signInWithOtp.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ data: { user: null, session: null }, error: null }) }))
    await user.type(screen.getByRole('textbox', { name: 'E-Mail-Adresse' }), 'student@example.test')
    const form = screen.getByRole('textbox', { name: 'E-Mail-Adresse' }).closest('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('angefordert'))
  })
  it('does not automatically send another email for an expired code', async () => {
    const { auth, user } = setup()
    auth.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'otp_expired' } })
    await user.type(screen.getByRole('textbox', { name: 'E-Mail-Adresse' }), 'student@example.test')
    await user.type(screen.getByRole('textbox', { name: 'Code aus der E-Mail' }), '12345678')
    await user.click(screen.getByRole('button', { name: 'Mit Code anmelden' }))
    expect(screen.getByRole('alert')).toHaveTextContent('abgelaufen')
    expect(auth.signInWithOtp).not.toHaveBeenCalled()
  })
  it('honors another tab’s send pause without storing email or code', async () => {
    const { user } = setup()
    await user.type(screen.getByRole('textbox', { name: 'E-Mail-Adresse' }), 'student@example.test')
    const key = mailCooldownKey(project)
    localStorage.setItem(key, String(Date.now() + 60000))
    fireEvent(window, new StorageEvent('storage', { key }))
    expect(screen.getByRole('button', { name: /Erneut anfragen/ })).toBeDisabled()
    expect(Object.values(localStorage).join('')).not.toContain('student@example.test')
  })
})

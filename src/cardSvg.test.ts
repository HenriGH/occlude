import { describe, expect, it } from 'vitest'
import { MAX_CARD_SVG_LENGTH, validCardSvg } from './cardSvg'
import { diagram } from './test/cardSvgFixture'

describe('passive card vector diagrams', () => {
  it('accepts complete diagrams, internal markers/gradients, Unicode and escaped text', () => {
    expect(validCardSvg(diagram)).toBe(true)
    expect(validCardSvg('')).toBe(true)
    expect(validCardSvg(diagram.replace('Logarithmusfunktion', 'A &amp; B &lt; C'))).toBe(true)
    expect(validCardSvg(diagram.replace('<defs>', '<defs><linearGradient id="shade"><stop offset="0" stop-color="#fff"/></linearGradient>'))).toBe(true)
  })
  it.each([
    '<script>alert(1)</script>', '<foreignObject><div>HTML</div></foreignObject>',
    '<image href="https://external.test/image.png"/>', '<use href="#arrow"/>',
    '<style>text{fill:red}</style>', '<animate attributeName="x"/>',
    '<text onclick="alert(1)">X</text>', '<text style="fill:red">X</text>',
    '<path fill="url(https://external.test/x)"/>', '<path fill="url(&#x68;ttps://external.test/x)"/>',
    '<svg viewBox="0 0 10 10"/>', '<?danger x?>', '<!DOCTYPE svg [<!ENTITY x "bad">]>',
  ])('rejects active or external markup %s', content => {
    expect(validCardSvg(diagram.replace('<title>', `${content}<title>`))).toBe(false)
  })
  it('rejects malformed XML, missing bounds/namespaces, deep and oversized documents', () => {
    for (const value of [undefined, null, '<svg/>', diagram.replace('viewBox="0 0 480 280"', 'viewBox="0 0 0 0"'), diagram.replace('</svg>', ''), diagram.replace('http://www.w3.org/2000/svg', 'https://evil.test'), diagram.replace('<title>', `${'<g>'.repeat(33)}${'</g>'.repeat(33)}<title>`), diagram.replace('<title>', `${'<rect/>'.repeat(2001)}<title>`), ' '.repeat(MAX_CARD_SVG_LENGTH + 1)]) expect(validCardSvg(value)).toBe(false)
  })
})

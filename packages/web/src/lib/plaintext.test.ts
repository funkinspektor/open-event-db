import { describe, expect, it } from 'vitest'
import { markdownToPlainText } from './plaintext'

describe('markdownToPlainText', () => {
  it('drops formatting syntax but keeps the words', () => {
    expect(markdownToPlainText('**Doors** at *23:00* — [Tickets](https://example.com)')).toBe(
      'Doors at 23:00 — Tickets',
    )
  })

  it('puts headings, paragraphs and list items on their own lines', () => {
    expect(markdownToPlainText('So einiges\n\n## Line-up\n- **DJ One**\n- DJ Two')).toBe(
      'So einiges\nLine-up\nDJ One\nDJ Two',
    )
  })

  it('drops raw HTML and keeps image alt text', () => {
    expect(markdownToPlainText('Hi <script>alert(1)</script> ![Flyer](x.png)')).toBe('Hi alert(1) Flyer')
  })

  it('leaves plain text alone', () => {
    expect(markdownToPlainText('Just text,\nsecond line')).toBe('Just text,\nsecond line')
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ChipInput } from './ChipInput'

function Harness({ initial = [] as string[], suggestions = [] as string[], max }: { initial?: string[]; suggestions?: string[]; max?: number }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <ChipInput label="Skills" value={value} onChange={setValue} suggestions={suggestions} max={max} />
      <output data-testid="value">{value.join('|')}</output>
    </>
  )
}

const value = () => screen.getByTestId('value').textContent

describe('ChipInput', () => {
  it('adds chips on Enter and comma', async () => {
    render(<Harness />)
    const input = screen.getByLabelText('Skills')
    await userEvent.type(input, 'react{Enter}css,')
    expect(value()).toBe('react|css')
    expect(input).toHaveValue('')
  })

  it('ignores blanks and case-insensitive duplicates', async () => {
    render(<Harness initial={['React']} />)
    await userEvent.type(screen.getByLabelText('Skills'), '   {Enter}react{Enter}')
    expect(value()).toBe('React')
  })

  it('uses the suggestion casing for known values', async () => {
    render(<Harness suggestions={['TypeScript']} />)
    await userEvent.type(screen.getByLabelText('Skills'), 'typescript{Enter}')
    expect(value()).toBe('TypeScript')
  })

  it('splits pasted comma lists', async () => {
    render(<Harness />)
    screen.getByLabelText('Skills').focus()
    await userEvent.paste('go, rust ,  zig')
    expect(value()).toBe('go|rust|zig')
  })

  it('removes chips with the × button and Backspace on an empty field', async () => {
    render(<Harness initial={['a', 'b', 'c']} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove b' }))
    expect(value()).toBe('a|c')
    await userEvent.type(screen.getByLabelText('Skills'), '{Backspace}')
    expect(value()).toBe('a')
  })

  it('commits the draft on blur', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByLabelText('Skills'), 'docs')
    await userEvent.tab()
    expect(value()).toBe('docs')
  })

  it('respects max', async () => {
    render(<Harness initial={['a']} max={2} />)
    await userEvent.type(screen.getByLabelText('Skills'), 'b{Enter}c{Enter}')
    expect(value()).toBe('a|b')
  })
})

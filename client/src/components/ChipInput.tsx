import { type KeyboardEvent, useId, useState } from 'react'

interface Props {
  label: string
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  suggestions?: string[]
  max?: number
}

/** Free-text tag input: Enter or comma adds, Backspace on an empty field removes the last chip. */
export function ChipInput({ label, value, onChange, placeholder, suggestions = [], max = 30 }: Props) {
  const [draft, setDraft] = useState('')
  const id = useId()
  const listId = `${id}-suggestions`

  const add = (raw: string) => {
    const incoming = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (incoming.length === 0) return
    const seen = new Set(value.map((v) => v.toLowerCase()))
    const next = [...value]
    for (const item of incoming) {
      // Use the suggestion's casing when the user typed a known value ("typescript" -> "TypeScript").
      const canonical = suggestions.find((s) => s.toLowerCase() === item.toLowerCase()) ?? item
      if (!seen.has(canonical.toLowerCase()) && next.length < max) {
        seen.add(canonical.toLowerCase())
        next.push(canonical)
      }
    }
    if (next.length !== value.length) onChange(next)
    setDraft('')
  }

  const remove = (item: string) => onChange(value.filter((v) => v !== item))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const remaining = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))

  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="chip-input">
        {value.map((item) => (
          <span key={item} className="chip">
            {item}
            <button type="button" className="chip-remove" aria-label={`Remove ${item}`} onClick={() => remove(item)}>
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={value.length ? '' : placeholder}
          list={remaining.length ? listId : undefined}
          onChange={(e) => {
            // Datalist picks and pasted "a, b" lists arrive via onChange.
            const v = e.target.value
            if (v.includes(',') || remaining.some((s) => s === v)) add(v)
            else setDraft(v)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
        />
        {remaining.length > 0 && (
          <datalist id={listId}>
            {remaining.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </div>
    </div>
  )
}

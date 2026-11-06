import { useId } from 'react'
import { DIFFICULTIES, type Difficulty } from '../api'

interface Props {
  label: string
  value: Difficulty | null
  onChange: (value: Difficulty | null) => void
  /** Show an "Any" option that maps to null. */
  allowAny?: boolean
}

const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1)

export function DifficultyPicker({ label, value, onChange, allowAny = true }: Props) {
  const name = useId()
  const options: (Difficulty | null)[] = allowAny ? [null, ...DIFFICULTIES] : DIFFICULTIES

  return (
    <fieldset className="field">
      <legend className="field-label">{label}</legend>
      <div className="segmented" role="radiogroup">
        {options.map((option) => (
          <label key={option ?? 'any'} className="segment">
            <input
              type="radio"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>{option ? capitalize(option) : 'Any'}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

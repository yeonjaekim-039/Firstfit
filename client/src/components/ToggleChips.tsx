interface Props {
  label: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  format?: (option: string) => string
}

/** Multi-select rendered as a wrap of toggle buttons. */
export function ToggleChips({ label, options, selected, onChange, format = (o) => o }: Props) {
  const toggle = (option: string) =>
    onChange(selected.includes(option) ? selected.filter((s) => s !== option) : [...selected, option])

  return (
    <fieldset className="field">
      <legend className="field-label">{label}</legend>
      <div className="toggle-chips">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className="toggle-chip"
            aria-pressed={selected.includes(option)}
            onClick={() => toggle(option)}
          >
            {format(option)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

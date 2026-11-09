import { type ReactNode, useState } from 'react'
import { DIFFICULTIES, type Difficulty, type IssueQuery } from '../api'

type Filters = Pick<IssueQuery, 'language' | 'label' | 'difficulty'>

interface Props {
  languages: string[]
  labels: string[]
  selected: Filters
  onChange: (patch: Partial<Filters>) => void
}

const VISIBLE_LANGUAGES = 3

const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1)

interface GroupProps {
  label: string
  /** Visible caption, for a group whose chips would be ambiguous without one. */
  caption?: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  format?: (option: string) => string
  children?: ReactNode
}

function ChipGroup({ label, caption, options, selected, onChange, format = (o) => o, children }: GroupProps) {
  const toggle = (option: string) =>
    onChange(selected.includes(option) ? selected.filter((s) => s !== option) : [...selected, option])

  return (
    <div className="filter-group" role="group" aria-label={label}>
      {caption && (
        <span className="filter-caption" aria-hidden>
          {caption}
        </span>
      )}
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
      {children}
    </div>
  )
}

export function FilterBar({ languages, labels, selected, onChange }: Props) {
  const [more, setMore] = useState(false)
  const extras = languages.slice(VISIBLE_LANGUAGES)
  // A selected language is never hidden, e.g. when it arrives in a shared URL.
  const extraSelected = selected.language.some((l) => extras.includes(l))
  const showExtras = more || extraSelected
  const hasFilters = selected.language.length + selected.label.length + selected.difficulty.length > 0

  return (
    <div className="filter-bar">
      <div className="discover-wrap filter-bar-inner">
        <span className="filter-show">Show</span>
        <ChipGroup
          label="Language"
          options={showExtras ? languages : languages.slice(0, VISIBLE_LANGUAGES)}
          selected={selected.language}
          onChange={(language) => {
            // Stay expanded when the last extra is deselected, so the chip under the cursor doesn't vanish.
            setMore(showExtras)
            onChange({ language })
          }}
        >
          {extras.length > 0 && !extraSelected && (
            <button type="button" className="toggle-chip" aria-expanded={showExtras} onClick={() => setMore(!showExtras)}>
              {showExtras ? 'Fewer languages' : 'More languages'}
            </button>
          )}
        </ChipGroup>
        <ChipGroup label="Label" options={labels} selected={selected.label} onChange={(label) => onChange({ label })} />
        <ChipGroup
          label="Difficulty"
          caption="Difficulty"
          options={DIFFICULTIES}
          format={capitalize}
          selected={selected.difficulty}
          onChange={(difficulty) => onChange({ difficulty: difficulty as Difficulty[] })}
        />
        {hasFilters && (
          <button
            type="button"
            className="btn btn-ghost btn-sm filter-clear"
            onClick={() => onChange({ language: [], label: [], difficulty: [] })}
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

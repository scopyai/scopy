import { useState } from "react"
import { Input } from "@workspace/ui/components/input"
import { Slider } from "@workspace/ui/components/slider"
import { cn } from "@workspace/ui/lib/utils"
import { SettingLabelRow } from "@/components/repositories/setting-label-row"

export const MAX_REVIEW_CHANGED_LINES_MIN = 1
export const MAX_REVIEW_CHANGED_LINES_MAX = 100_000
export const MAX_REVIEW_CHANGED_LINES_SLIDER_MIN = 1_000
export const MAX_REVIEW_CHANGED_LINES_SLIDER_MAX = 30_000
export const MAX_REVIEW_CHANGED_LINES_SLIDER_STEP = 500

const SLIDER_THUMB_SIZE = 16

const SLIDER_MARKS = [5_000, 10_000, 15_000, 20_000, 25_000, 30_000] as const

interface MaxReviewChangedLinesInputProps {
  id: string
  value: number
  onChange: (value: number) => void
  disabled?: boolean
  scopeBadge?: React.ReactNode
}

export function MaxReviewChangedLinesInput({
  id,
  value,
  onChange,
  disabled,
  scopeBadge,
}: MaxReviewChangedLinesInputProps) {
  return (
    <MaxReviewChangedLinesInputControls
      key={value}
      id={id}
      value={value}
      onChange={onChange}
      disabled={disabled}
      scopeBadge={scopeBadge}
    />
  )
}

function MaxReviewChangedLinesInputControls({
  id,
  value,
  onChange,
  disabled,
  scopeBadge,
}: MaxReviewChangedLinesInputProps) {
  const sliderPosition = toSliderPosition(value)
  const [previewValue, setPreviewValue] = useState(sliderPosition)
  const showInput =
    previewValue >= MAX_REVIEW_CHANGED_LINES_SLIDER_MAX &&
    value >= MAX_REVIEW_CHANGED_LINES_SLIDER_MAX

  const commitSliderValue = (next: number) => {
    const snapped = snapSliderValue(next)
    setPreviewValue(snapped)
    onChange(snapped)
  }

  const commitInputValue = (raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) {
      return
    }

    const clamped = Math.min(
      MAX_REVIEW_CHANGED_LINES_MAX,
      Math.max(MAX_REVIEW_CHANGED_LINES_MIN, parsed)
    )

    onChange(clamped)
    setPreviewValue(toSliderPosition(clamped))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SettingLabelRow
          htmlFor={id}
          label="Maximum changed lines"
          scopeBadge={scopeBadge}
        />
        <p className="text-xs text-muted-foreground">
          Skip reviews when a pull request changes more than this many lines.
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-x-3 gap-y-2">
        <div className="relative w-full">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-3.5 -translate-y-1/2"
          >
            {SLIDER_MARKS.map((mark) => (
              <SliderTick key={mark} mark={mark} />
            ))}
          </div>

          <Slider
            id={id}
            value={[previewValue]}
            min={MAX_REVIEW_CHANGED_LINES_SLIDER_MIN}
            max={MAX_REVIEW_CHANGED_LINES_SLIDER_MAX}
            step={MAX_REVIEW_CHANGED_LINES_SLIDER_STEP}
            disabled={disabled}
            onValueChange={([next]) => setPreviewValue(snapSliderValue(next))}
            onValueCommit={([next]) => commitSliderValue(next)}
            className="relative z-10"
          />
        </div>

        <MaxLinesValueSlot
          key={value}
          id={`${id}-custom`}
          displayValue={formatLines(showInput ? value : previewValue)}
          editable={showInput}
          value={value}
          disabled={disabled}
          onCommit={commitInputValue}
        />

        <div className="relative col-start-1 h-4 w-full">
          {SLIDER_MARKS.map((mark) => (
            <SliderMarkLabel key={mark} mark={mark} />
          ))}
        </div>
      </div>
    </div>
  )
}

function MaxLinesValueSlot({
  id,
  displayValue,
  editable,
  value,
  disabled,
  onCommit,
}: {
  id: string
  displayValue: string
  editable: boolean
  value: number
  disabled?: boolean
  onCommit: (raw: string) => void
}) {
  const [draft, setDraft] = useState(String(value))

  return (
    <div className="relative h-8 w-full shrink-0">
      <span
        aria-hidden={editable}
        className={cn(
          "absolute inset-0 flex items-center justify-end text-sm font-medium tabular-nums",
          editable && "invisible"
        )}
      >
        {displayValue}
      </span>

      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={MAX_REVIEW_CHANGED_LINES_MIN}
        max={MAX_REVIEW_CHANGED_LINES_MAX}
        value={draft}
        disabled={disabled}
        tabIndex={editable ? 0 : -1}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (editable) onCommit(draft)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
        className={cn(
          "absolute inset-0 h-8 w-full px-2 text-right text-sm font-medium tabular-nums",
          !editable && "pointer-events-none invisible"
        )}
      />
    </div>
  )
}

function SliderTick({ mark }: { mark: number }) {
  return (
    <div
      className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/50"
      style={markToThumbStyle(mark)}
    />
  )
}

function SliderMarkLabel({ mark }: { mark: number }) {
  return (
    <span
      className="absolute -translate-x-1/2 text-[10px] leading-none text-muted-foreground tabular-nums"
      style={markToThumbStyle(mark)}
    >
      {formatCompactLines(mark)}
    </span>
  )
}

function toSliderPosition(value: number) {
  if (value > MAX_REVIEW_CHANGED_LINES_SLIDER_MAX) {
    return MAX_REVIEW_CHANGED_LINES_SLIDER_MAX
  }

  return snapSliderValue(
    Math.min(
      MAX_REVIEW_CHANGED_LINES_SLIDER_MAX,
      Math.max(MAX_REVIEW_CHANGED_LINES_SLIDER_MIN, value)
    )
  )
}

function snapSliderValue(value: number) {
  const stepped =
    Math.round(
      (value - MAX_REVIEW_CHANGED_LINES_SLIDER_MIN) /
        MAX_REVIEW_CHANGED_LINES_SLIDER_STEP
    ) *
      MAX_REVIEW_CHANGED_LINES_SLIDER_STEP +
    MAX_REVIEW_CHANGED_LINES_SLIDER_MIN

  return Math.min(
    MAX_REVIEW_CHANGED_LINES_SLIDER_MAX,
    Math.max(MAX_REVIEW_CHANGED_LINES_SLIDER_MIN, stepped)
  )
}

function markToThumbStyle(mark: number) {
  const min = MAX_REVIEW_CHANGED_LINES_SLIDER_MIN
  const max = MAX_REVIEW_CHANGED_LINES_SLIDER_MAX
  const percent = (mark - min) / (max - min)
  const thumb = SLIDER_THUMB_SIZE

  return {
    left: `calc(${percent * 100}% + ${thumb / 2}px - ${percent * thumb}px)`,
  }
}

function formatLines(value: number) {
  return value.toLocaleString()
}

function formatCompactLines(value: number) {
  if (value >= 1_000) {
    return `${value / 1_000}k`
  }
  return String(value)
}

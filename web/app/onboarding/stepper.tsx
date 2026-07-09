import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Stepper({
  steps,
  current,
}: {
  steps: readonly string[]
  current: number
}) {
  return (
    <ol className="flex items-center justify-center gap-2">
      {steps.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary text-primary",
                  !done && !active && "border-border text-muted-foreground"
                )}
              >
                {done ? <CheckIcon className="size-3.5" /> : i + 1}
              </span>
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "text-sm font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "ml-1 h-px w-8 sm:w-12",
                  done ? "bg-primary" : "bg-border"
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

export { Stepper }

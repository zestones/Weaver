// A moment as the owner's own clock and calendar have it, written as `2026-10-12 23:52`.
export class LocalMoment {
  readonly text: string

  constructor(moment: Date | string) {
    const date = new Date(moment)
    const two = (value: number): string => String(value).padStart(2, '0')
    const day = `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())}`

    this.text = `${day} ${two(date.getHours())}:${two(date.getMinutes())}`
  }
}

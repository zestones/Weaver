// A moment as the day it falls on where the owner is, written as `2026-10-01`.
export class LocalDay {
  readonly text: string

  constructor(moment: Date) {
    const two = (value: number): string => String(value).padStart(2, '0')

    this.text = `${String(moment.getFullYear())}-${two(moment.getMonth() + 1)}-${two(moment.getDate())}`
  }
}

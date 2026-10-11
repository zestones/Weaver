// What a review left for the owner: a finding the author did not fix, or a suspicion of the reviewer.
export interface OwnerPoint {
  // The review it comes from, and its name there: `3f9a2c1/F1`, `3f9a2c1/S1`.
  readonly id: string
  readonly rule: string | null
  readonly file: string | null
  readonly line: number | null
  readonly message: string
  // Why it waits for the owner.
  readonly standing: string
  readonly session: string
  readonly at: string
}

export type Closing = 'fixed' | 'wontfix' | 'issue'

export interface FollowedPoint extends OwnerPoint {
  readonly closed: { readonly as: Closing; readonly note: string | null; readonly at: string } | null
}

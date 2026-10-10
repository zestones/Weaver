import type { WriteScope } from '../../lib/shell/writes/write-scope.ts'

export class Attribution {
  private readonly scope: WriteScope

  constructor(scope: WriteScope) {
    this.scope = scope
  }

  charges(path: string): boolean {
    const { scope } = this

    if (scope === 'all' || scope === 'none') return scope === 'all'

    return scope.some((target) => path === target || path.startsWith(`${target}/`))
  }
}

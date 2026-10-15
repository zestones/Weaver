export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    // The process is there, and belongs to someone else.
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/**
 * Garment selection is allowed only while the claimed session is live.
 * ENDED / WAITING / EXPIRED sessions must not accept writes.
 */
export function sessionCanMutateGarment(status: string): boolean {
  return status === 'PAIRED' || status === 'ACTIVE';
}

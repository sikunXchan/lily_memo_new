import { createId } from '@paralleldrive/cuid2';

export function generateServerId(): string {
  return createId();
}

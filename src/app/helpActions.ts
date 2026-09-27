/**
 * Reads for the grown-ups' Help tab (src/adult/Help.tsx). It counts "all
 * time" too, so it reads a child's whole kept log rather than the 120-day
 * window `recentLog` caches. Read-only.
 */
import type { LogRecord } from '../core/log/types';
import { repo } from './services';

/** Every known record of a child's log still kept raw on this device, oldest first. */
export function wholeLog(pid: string): LogRecord[] {
  return repo.readKnownLog(pid);
}

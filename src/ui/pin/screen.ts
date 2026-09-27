/**
 * The parent-PIN gate is its own chunk, like the dashboard behind it
 * (adult/screen.ts): most visits never open either. App.tsx renders it for
 * #/adult until the PIN is entered (DESIGN A-30).
 */
import { lazyScreen } from '../../modes/lazy';

export const PinGateScreen = lazyScreen(() => import('./PinGate').then((m) => m.PinGate));

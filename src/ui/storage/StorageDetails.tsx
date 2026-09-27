/**
 * Adult Data tab, storage (§4 step 11): where the answer history lives and
 * how much it takes, whether the browser may evict it, and a "keep data safe"
 * button (navigator.storage.persist()).
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { storage } from '../../app/services';
import { Icon } from '../components/Icon';
import { useT } from '../hooks';
import './storage.css';

/** Shown at the top of the tab: meta says the history is in IndexedDB, but it could not be opened on this visit. */
export function StorageWarning(): JSX.Element | null {
  const t = useT();
  return storage?.historyUnavailable ? <p class="warn storage-hidden">{t('storage.historyHidden')}</p> : null;
}

/** Lines for the storage card, under the localStorage usage line. */
export function StorageDetails({ idbBytes }: { idbBytes: number }): JSX.Element | null {
  const t = useT();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    let live = true;
    void storage?.persisted().then((v) => live && setPersisted(v));
    return () => {
      live = false;
    };
  }, []);
  const s = storage;
  if (!s) return null;
  const keepSafe = async (): Promise<void> => {
    const ok = await s.persist();
    setAsked(true);
    setPersisted(ok || (await s.persisted()));
  };
  return (
    <>
      {s.mode === 'idb' && <p class="storage-idb">{t('storage.idbUsed', { kb: Math.round(idbBytes / 1024) })}</p>}
      {s.mode === 'local' && s.fallback !== 'no-local-storage' && !s.historyUnavailable && <p class="muted storage-local">{t('storage.localOnly')}</p>}
      {persisted !== null && <p class="storage-persist">{t(persisted ? 'storage.persisted' : 'storage.notPersisted')}</p>}
      {persisted === false && (
        <div class="row wrap">
          <button type="button" class="btn keep-safe" onClick={() => void keepSafe()}>
            <Icon name="shield" /> {t('storage.keepSafe')}
          </button>
        </div>
      )}
      {asked && persisted === false && (
        <p class="muted" role="status">
          {t('storage.keepSafeDenied')}
        </p>
      )}
    </>
  );
}

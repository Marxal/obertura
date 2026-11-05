import { t } from './i18n';
// A shared "the data wouldn't load" panel for the screens that read from
// IndexedDB. If openDB() rejects (private-mode, quota, a blocked upgrade from
// another tab), the screen's `await getAllLines()` throws — without this the
// spinner would hang forever as an unhandled rejection. Instead we show a
// friendly message and a Retry button that re-runs the render.

// Pull a human message off an unknown thrown value (a non-Error becomes a
// generic line rather than `undefined`).
function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return t('mid.yourSavedDataCouldn');
}

// Replace the container's contents with an error + Retry. `onRetry` is the
// screen's own render call, so tapping Retry simply tries the load again.
export function renderLoadError(
  container: HTMLElement,
  err: unknown,
  onRetry: () => void,
): void {
  console.error('[storage] load failed', err);
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'train-empty';

  const title = document.createElement('p');
  title.className = 'train-empty-title';
  title.textContent = t('mid.couldnTLoadYour');
  wrap.appendChild(title);

  const body = document.createElement('p');
  body.className = 'train-empty-body';
  body.textContent =
    t('mid.thisCanHappenIn', { error: messageOf(err) });
  wrap.appendChild(body);

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'train-next-btn';
  retry.textContent = t('mid.retry');
  retry.addEventListener('click', onRetry);
  wrap.appendChild(retry);

  container.appendChild(wrap);
}

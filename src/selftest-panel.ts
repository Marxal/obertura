// Shared "Run X self-test" panel. The three original screens (Train, Lines,
// Progress) each grew a near-identical version of this renderer; the newer
// data-layer self-tests share this one instead. It accepts a sync OR async
// runner, so storage tests (which await IndexedDB) render the same way as the
// pure-logic ones, and it shows a clear message if a runner throws.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function appendSelfTest(
  container: HTMLElement,
  label: string,
  runner: () => TestResult[] | Promise<TestResult[]>,
  consoleTag: string,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'selftest-wrap';

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'selftest-link';
  link.textContent = label;

  const out = document.createElement('div');
  out.className = 'selftest-output';
  out.hidden = true;

  link.addEventListener('click', async () => {
    out.hidden = false;
    out.innerHTML = '';
    link.disabled = true;
    try {
      const results = await runner();
      const passed = results.filter(r => r.pass).length;

      const head = document.createElement('div');
      head.className = `selftest-head ${passed === results.length ? 'ok' : 'fail'}`;
      head.textContent = `${passed}/${results.length} checks passed`;
      out.appendChild(head);

      for (const r of results) {
        const row = document.createElement('div');
        row.className = `selftest-row ${r.pass ? 'ok' : 'fail'}`;
        row.textContent = `${r.pass ? '✓' : '✗'} ${r.name} — ${r.detail}`;
        out.appendChild(row);
      }
      console.log(consoleTag, results);
    } catch (err) {
      const head = document.createElement('div');
      head.className = 'selftest-head fail';
      head.textContent = `Self-test threw — ${err instanceof Error ? err.message : String(err)}`;
      out.appendChild(head);
      console.error(consoleTag, err);
    } finally {
      link.disabled = false;
    }
  });

  wrap.appendChild(link);
  wrap.appendChild(out);
  container.appendChild(wrap);
}

document.addEventListener(
  'DOMContentLoaded',
  () => {

    const copyBtn =
      document.getElementById(
        'copyBtn'
      );

    const downloadBtn =
      document.getElementById(
        'downloadBtn'
      );

    const status =
      document.getElementById(
        'status'
      );

    const formatInputs =
      document.querySelectorAll(
        'input[name="format"]'
      );

    const savedFormat =
      localStorage.getItem(
        'ive-export-format'
      );

    if (savedFormat) {
      const input =
        document.querySelector(
          `input[value="${savedFormat}"]`
        );

      if (input) {
        input.checked = true;
      }
    }

    formatInputs.forEach(
      input => {
        input.addEventListener(
          'change',
          () => {
            localStorage.setItem(
              'ive-export-format',
              input.value
            );
          }
        );
      }
    );

    function getFormat() {
      const selected =
        document.querySelector(
          'input[name="format"]:checked'
        );

      return (
        selected?.value ||
        'markdown'
      );
    }

    async function getExportData() {

      const tabs =
        await chrome.tabs.query({
          active: true,
          currentWindow: true
        });

      const tab = tabs[0];

      if (!tab?.id) {
        throw new Error(
          'Could not find the active tab.'
        );
      }

      if (
        !tab.url ||
        !tab.url.includes(
          'insights.gg'
        )
      ) {
        throw new Error(
          'Open an Insights.gg VOD first.'
        );
      }

      const response =
        await chrome.tabs.sendMessage(
          tab.id,
          {
            action:
              'exportComments',
            format:
              getFormat()
          }
        );

      if (
        !response?.success
      ) {
        throw new Error(
          response?.error ||
          'Export failed.'
        );
      }

      return response;
    }

    async function copyResult(
      result
    ) {

      /*
       * Plain text / Markdown / Discord
       */
      if (
        result.mime ===
        'text/plain'
      ) {

        await navigator.clipboard.writeText(
          result.text
        );

        return;
      }

      /*
       * Google Docs:
       * copy HTML + plain text fallback.
       */
      if (
        result.mime ===
        'text/html'
      ) {

        if (
          typeof ClipboardItem ===
          'undefined'
        ) {
          await navigator.clipboard.writeText(
            result.text
          );

          return;
        }

        const item =
          new ClipboardItem({
            'text/html':
              new Blob(
                [result.html],
                {
                  type:
                    'text/html'
                }
              ),

            'text/plain':
              new Blob(
                [result.text],
                {
                  type:
                    'text/plain'
                }
              )
          });

        await navigator.clipboard.write([
          item
        ]);

        return;
      }

      throw new Error(
        'Unknown clipboard format.'
      );
    }

    async function downloadResult(
      result
    ) {

      const blob =
        new Blob(
          [result.content],
          {
            type:
              result.mime
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      const a =
        document.createElement(
          'a'
        );

      a.href = url;
      a.download =
        result.filename;

      document.body.appendChild(
        a
      );

      a.click();

      a.remove();

      setTimeout(
        () =>
          URL.revokeObjectURL(
            url
          ),
        1000
      );
    }

    async function runExport(
      mode
    ) {

      copyBtn.disabled = true;
      downloadBtn.disabled = true;

      status.textContent =
        'Fetching comments…';

      try {

        const result =
          await getExportData();

        status.textContent =
          mode === 'copy'
            ? 'Copying…'
            : 'Downloading…';

        if (
          mode === 'copy'
        ) {

          await copyResult(
            result
          );

        } else {

          await downloadResult(
            result
          );
        }

        status.textContent =
          `${
            mode === 'copy'
              ? 'Copied'
              : 'Downloaded'
          } ${result.total} comments ✓`;

      } catch (error) {

        console.error(
          '[Insights VOD Comment Exporter]',
          error
        );

        status.textContent =
          error?.message ||
          String(error);

      } finally {

        copyBtn.disabled = false;
        downloadBtn.disabled = false;
      }
    }

    copyBtn.addEventListener(
      'click',
      () =>
        runExport('copy')
    );

    downloadBtn.addEventListener(
      'click',
      () =>
        runExport('download')
    );

  }
);
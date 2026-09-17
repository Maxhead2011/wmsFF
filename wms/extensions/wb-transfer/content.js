// FIX: only the top-level trusted WMS page can reach the narrow extension protocol.
(() => {
  if (window !== window.top || location.origin !== 'https://wms.logoff.pro') return;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'LOGOFF_WB_REQUEST' ||
        typeof event.data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(event.data.id) ||
        !['PING', 'PREPARE', 'EXECUTE'].includes(event.data.message?.kind)) return;
    const id = event.data.id;
    chrome.runtime.sendMessage(event.data.message).then(response => {
      window.postMessage({ channel: 'LOGOFF_WB_RESPONSE', id, response }, location.origin);
    }, () => {
      window.postMessage({ channel: 'LOGOFF_WB_RESPONSE', id, response: { ok: false, error: 'Перезагрузите страницу ВМС после установки расширения.' } }, location.origin);
    });
  });
})();

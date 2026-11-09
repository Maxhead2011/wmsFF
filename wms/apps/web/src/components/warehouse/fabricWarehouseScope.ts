// FIX: alternate installation hosts are deployment configuration, not product data.
export function fabricWarehouseEnabled(hostname: string): boolean {
  const configured = String(import.meta.env.VITE_OUR_WMS_HOSTS ?? 'wms.logoff.pro');
  return configured.split(',').map(host => host.trim()).filter(Boolean).includes(hostname);
}

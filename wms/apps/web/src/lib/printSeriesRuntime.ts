import {submitPreparedSeries} from './printSeries';
import {installPhoneLayout} from './phoneLayout';
// FIX: bridge for the verified production graph while source/runtime parity is incomplete.
if(['wms.logoff.pro','localhost','127.0.0.1'].includes(location.hostname)) {
  (globalThis as unknown as {LOGOFF_PRINT_SERIES:unknown}).LOGOFF_PRINT_SERIES={submit:submitPreparedSeries};
  installPhoneLayout();
}

import React, { useCallback, useEffect, useState } from 'react';
import AppAlertModal from '../components/common/AppAlertModal';
import { appAlert, registerAppAlertHandlers } from '../utils/appAlert';

export function AppAlertProvider({ children }) {
  // Hàng đợi popup: thông báo đến dồn dập (VD "bị từ chối" rồi "đã hoàn tiền") hiện lần lượt, không đè nhau
  const [alertQueue, setAlertQueue] = useState([]);
  const alertState = alertQueue[0] || null;
  const [confirmState, setConfirmState] = useState(null);

  const closeAlert = useCallback(() => setAlertQueue((q) => q.slice(1)), []);

  useEffect(() => {
    registerAppAlertHandlers({
      show: (payload) => setAlertQueue((q) => [...q, payload]),
      showConfirm: (payload) => setConfirmState(payload),
    });

    const nativeAlert = window.alert.bind(window);
    window.alert = (message) => {
      appAlert(String(message ?? ''));
    };

    return () => {
      window.alert = nativeAlert;
      registerAppAlertHandlers({ show: null, showConfirm: null });
    };
  }, []);

  return (
    <>
      {children}
      {alertState && (
        <AppAlertModal
          {...alertState}
          mode="alert"
          onClose={() => {
            alertState.onClose?.();
            closeAlert();
          }}
        />
      )}
      {confirmState && (
        <AppAlertModal
          {...confirmState}
          mode="confirm"
          onConfirm={() => {
            confirmState.onConfirm?.();
            setConfirmState(null);
          }}
          onCancel={() => {
            confirmState.onCancel?.();
            setConfirmState(null);
          }}
        />
      )}
    </>
  );
}
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { tripApi } from '../api/endpoints';
import { getApiError } from '../api/client';
import { useSocketEvent } from './SocketContext';
import { geoErrorMessage, getBatteryLevel } from '../lib/geo';
import { TRACKING_DENIED_TEXT, humanize } from '../lib/constants';

/**
 * Foreground location sharing from the browser for one trip.
 * Posts the latest fix to POST /trips/:id/location, throttled to the server's `next_interval_sec`.
 * Stops on 403 TRACKING_NOT_ALLOWED or the `tracking:stop` socket event.
 */
export function useLocationSharing({ tripId, enabled, defaultIntervalSec = 30, onEvents }) {
  const qc = useQueryClient();
  const [state, setState] = useState({ status: 'idle', error: null, lastSentAt: null, intervalSec: defaultIntervalSec, lastFix: null });
  const [stoppedReason, setStoppedReason] = useState(null);
  const latestRef = useRef(null);
  const watchRef = useRef(null);
  const timerRef = useRef(null);
  const activeRef = useRef(false);
  const sendingRef = useRef(false);
  const intervalRef = useRef(defaultIntervalSec);
  const sendRef = useRef(null);
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;

  const stopAll = useCallback(() => {
    activeRef.current = false;
    if (watchRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = useCallback((sec) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!activeRef.current) return;
    timerRef.current = setTimeout(() => sendRef.current?.(), Math.max(5, sec) * 1000);
  }, []);

  const sendLatest = useCallback(async () => {
    if (!activeRef.current || sendingRef.current) return;
    const fix = latestRef.current;
    if (!fix) {
      schedule(5);
      return;
    }
    sendingRef.current = true;
    try {
      const battery = await getBatteryLevel();
      const body = {
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy ?? undefined,
        speed: fix.speed ?? undefined,
        battery,
        timestamp: new Date(fix.timestamp).toISOString(),
      };
      const res = await tripApi.postLocation(tripId, body);
      const next = Number(res?.next_interval_sec) || intervalRef.current || defaultIntervalSec;
      intervalRef.current = next;
      setState((s) => ({ ...s, status: 'sharing', error: null, lastSentAt: new Date().toISOString(), intervalSec: next }));
      if (res?.events?.length) {
        onEventsRef.current?.(res.events);
        qc.invalidateQueries({ queryKey: ['trip', String(tripId)] });
      }
      schedule(next);
    } catch (err) {
      const e = getApiError(err);
      if (e.code === 'TRACKING_NOT_ALLOWED') {
        stopAll();
        const reason = e.details?.reason;
        setStoppedReason(reason || 'TRACKING_NOT_ALLOWED');
        setState((s) => ({ ...s, status: 'stopped', error: TRACKING_DENIED_TEXT[reason] || e.message }));
        qc.invalidateQueries({ queryKey: ['trip', String(tripId)] });
      } else {
        setState((s) => ({ ...s, error: `Last upload failed: ${e.message}. Retrying…` }));
        schedule(Math.min(intervalRef.current || defaultIntervalSec, 30));
      }
    } finally {
      sendingRef.current = false;
    }
  }, [tripId, defaultIntervalSec, qc, schedule, stopAll]);
  sendRef.current = sendLatest;

  useEffect(() => {
    if (!enabled || !tripId) {
      stopAll();
      setState((s) => (s.status === 'stopped' ? s : { ...s, status: 'idle' }));
      return undefined;
    }
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, status: 'error', error: 'Location is not supported by this browser.' }));
      return undefined;
    }
    activeRef.current = true;
    setStoppedReason(null);
    setState((s) => ({ ...s, status: 'starting', error: null }));
    let firstSent = false;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        latestRef.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          timestamp: pos.timestamp || Date.now(),
        };
        setState((s) => ({ ...s, lastFix: latestRef.current }));
        if (!firstSent) {
          firstSent = true;
          sendLatest();
        }
      },
      (err) => {
        setState((s) => ({ ...s, status: err.code === 1 ? 'error' : s.status, error: geoErrorMessage(err) }));
        if (err.code === 1) stopAll();
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
    return () => stopAll();
  }, [enabled, tripId, sendLatest, stopAll]);

  useSocketEvent('tracking:stop', (p) => {
    if (String(p?.tripId) !== String(tripId)) return;
    stopAll();
    setStoppedReason(p.reason);
    setState((s) => ({ ...s, status: 'stopped', error: `Sharing stopped: ${humanize(p.reason)}` }));
    qc.invalidateQueries({ queryKey: ['trip', String(tripId)] });
    qc.invalidateQueries({ queryKey: ['outpass'] });
  });

  return { ...state, stoppedReason, sendNow: sendLatest };
}

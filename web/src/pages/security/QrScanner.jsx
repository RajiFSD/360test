import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { CameraOff, SwitchCamera } from 'lucide-react';
import { Button } from '../../components/ui';

let mountSeq = 0;

function describeCameraError(err) {
  const msg = String(err?.message || err || '');
  if (/permission|NotAllowed/i.test(msg)) return 'Camera permission was denied. Allow camera access or paste the token below.';
  if (/NotFound|no camera|Requested device not found|OverconstrainedError/i.test(msg))
    return 'No camera found on this device. Paste the token below instead.';
  if (/secure|https|insecure/i.test(msg)) return 'The camera needs a secure (HTTPS or localhost) connection.';
  return `Could not start the camera. ${msg}`;
}

/**
 * Camera QR scanner built on html5-qrcode. Calls onDecode(text) for each new decode.
 * Set `active=false` while the parent handles a result to pause the camera.
 */
export function QrScanner({ onDecode, active = true }) {
  const containerRef = useRef(null);
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
  const camerasRef = useRef([]);
  const [error, setError] = useState(null);
  const [cameraCount, setCameraCount] = useState(0);
  const [cameraIndex, setCameraIndex] = useState(-1); // -1 = rear camera via facingMode

  useEffect(() => {
    Html5Qrcode.getCameras()
      .then((list) => {
        camerasRef.current = list || [];
        setCameraCount(camerasRef.current.length);
      })
      .catch(() => {
        camerasRef.current = [];
        setCameraCount(0);
      });
  }, []);

  useEffect(() => {
    if (!active || !containerRef.current) return undefined;
    // Each run gets its own child element so a slow stop() can't clobber a new scanner.
    const el = document.createElement('div');
    el.id = `qr-reader-${++mountSeq}`;
    el.style.width = '100%';
    containerRef.current.appendChild(el);

    let cancelled = false;
    let lastText = null;
    let lastAt = 0;
    const scanner = new Html5Qrcode(el.id, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
    const cams = camerasRef.current;
    const camera = cameraIndex >= 0 && cams[cameraIndex] ? cams[cameraIndex].id : { facingMode: 'environment' };
    setError(null);

    const startPromise = scanner
      .start(
        camera,
        {
          fps: 10,
          qrbox: (w, h) => {
            const size = Math.max(150, Math.floor(Math.min(w, h) * 0.75));
            return { width: size, height: size };
          },
        },
        (text) => {
          const now = Date.now();
          if (cancelled || (text === lastText && now - lastAt < 3000)) return;
          lastText = text;
          lastAt = now;
          onDecodeRef.current?.(text);
        },
        () => {},
      )
      .catch((err) => {
        if (!cancelled) setError(describeCameraError(err));
      });

    return () => {
      cancelled = true;
      startPromise.finally(() => {
        const finish = () => {
          try {
            scanner.clear();
          } catch {
            /* ignore */
          }
          el.remove();
        };
        if (scanner.isScanning) scanner.stop().catch(() => {}).finally(finish);
        else finish();
      });
    };
  }, [active, cameraIndex]);

  const currentLabel = cameraIndex >= 0 ? camerasRef.current[cameraIndex]?.label || `Camera ${cameraIndex + 1}` : 'Rear camera';

  return (
    <div className="space-y-2">
      <div className="relative min-h-[16rem] overflow-hidden rounded-2xl bg-slate-900">
        <div ref={containerRef} className="w-full [&_video]:!w-full [&_video]:object-cover" aria-label="Camera preview" />
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-200">
            <CameraOff className="h-8 w-8 text-slate-400" aria-hidden="true" />
            <p role="alert">{error}</p>
          </div>
        )}
      </div>
      {cameraCount > 1 && (
        <Button variant="secondary" size="sm" icon={SwitchCamera} onClick={() => setCameraIndex((i) => (i + 1) % cameraCount)}>
          Switch camera ({currentLabel})
        </Button>
      )}
    </div>
  );
}

import { useState } from 'react';
import { BellRing, Send, Users } from 'lucide-react';
import { useNotifyTrip } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Button, Field, Textarea } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';

const LABELS = { student: 'student', parent: 'parent(s)', both: 'student and parent(s)' };

/** One-tap "Notify student" / "Notify parent" buttons for a trip (POST /trips/:id/notify). */
export function NotifyButtons({ tripId, compact = false }) {
  const notify = useNotifyTrip();
  const toast = useToast();
  const [custom, setCustom] = useState(null); // target for custom message
  const [message, setMessage] = useState('');
  const [busyTarget, setBusyTarget] = useState(null);

  const send = (target, msg) => {
    setBusyTarget(target);
    notify.mutate(
      { id: tripId, target, message: msg || undefined },
      {
        onSuccess: (r) => {
          toast.success(`Notified ${LABELS[target]}`, r?.sent != null ? `${r.sent} notification${r.sent === 1 ? '' : 's'} sent.` : undefined);
          setCustom(null);
          setMessage('');
        },
        onError: (err) => toast.error('Could not send notification', getErrorMessage(err)),
        onSettled: () => setBusyTarget(null),
      },
    );
  };

  return (
    <div className={compact ? 'flex flex-wrap gap-2' : 'space-y-2'}>
      <div className="flex flex-wrap gap-2">
        <Button size={compact ? 'sm' : 'md'} icon={BellRing} loading={busyTarget === 'student'} onClick={() => send('student')}>
          Notify student
        </Button>
        <Button size={compact ? 'sm' : 'md'} variant="warning" icon={Users} loading={busyTarget === 'parent'} onClick={() => send('parent')}>
          Notify parent
        </Button>
      </div>
      <Button size="sm" variant="ghost" icon={Send} onClick={() => setCustom('both')}>
        Custom message…
      </Button>
      <Modal
        open={!!custom}
        onClose={() => setCustom(null)}
        title="Send a custom message"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCustom(null)}>
              Cancel
            </Button>
            <Button icon={Send} loading={notify.isPending} disabled={!message.trim()} onClick={() => send(custom, message.trim())}>
              Send
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Send to">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Recipients">
              {['student', 'parent', 'both'].map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={custom === t}
                  onClick={() => setCustom(t)}
                  className={`rounded-full border px-3 py-1 text-sm capitalize focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    custom === t ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600'
                  }`}
                >
                  {LABELS[t]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Message" htmlFor="notify-msg" required>
            <Textarea
              id="notify-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Please return to campus immediately and contact the warden office."
              maxLength={500}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

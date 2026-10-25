import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsWatchdog } from '../js-watchdog.js';

describe('JS watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (budgetMs = 100) => {
    const sendProbe = vi.fn();
    const onUnresponsive = vi.fn();
    const watchdog = createJsWatchdog({
      sendProbe,
      onUnresponsive,
      initialBudget: { ms: budgetMs, label: 'idle' },
      probeIntervalMs: 10,
    });

    // Answers every probe sent so far, like a responsive JS thread.
    const ackAll = () => {
      for (const [id] of sendProbe.mock.calls) watchdog.notifyProbeAck(id);
    };

    return { sendProbe, onUnresponsive, watchdog, ackAll };
  };

  it('stays healthy while probes are acknowledged', () => {
    const { onUnresponsive, watchdog, ackAll } = setup();

    for (let i = 0; i < 100; i++) {
      vi.advanceTimersByTime(10);
      ackAll();
    }

    expect(onUnresponsive).not.toHaveBeenCalled();
    watchdog.dispose();
  });

  it('sends one probe at a time', () => {
    const { sendProbe, watchdog } = setup();

    vi.advanceTimersByTime(50);

    expect(sendProbe).toHaveBeenCalledTimes(1);
    expect(sendProbe).toHaveBeenCalledWith(1);
    watchdog.dispose();
  });

  it('reports the budget once the thread is silent for longer than it allows', () => {
    const { onUnresponsive } = setup(100);

    vi.advanceTimersByTime(100);
    expect(onUnresponsive).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);
    expect(onUnresponsive).toHaveBeenCalledTimes(1);
    expect(onUnresponsive).toHaveBeenCalledWith({ ms: 100, label: 'idle' });

    vi.advanceTimersByTime(1_000);
    expect(onUnresponsive).toHaveBeenCalledTimes(1);
  });

  it('ignores acks for probes it is not waiting for', () => {
    const { onUnresponsive, watchdog } = setup(100);

    vi.advanceTimersByTime(50);
    watchdog.notifyProbeAck(42);
    vi.advanceTimersByTime(60);

    expect(onUnresponsive).toHaveBeenCalledTimes(1);
  });

  it('lets a larger budget cover a long block', () => {
    const { onUnresponsive, watchdog, ackAll } = setup(100);

    watchdog.setBlockBudget({ ms: 1_000, label: 'test "slow"' });
    vi.advanceTimersByTime(900);
    expect(onUnresponsive).not.toHaveBeenCalled();

    ackAll();
    vi.advanceTimersByTime(10);
    expect(onUnresponsive).not.toHaveBeenCalled();
    watchdog.dispose();
  });

  it('does not judge a block that fitted the previous budget against a smaller one', () => {
    const { onUnresponsive, watchdog } = setup(1_000);

    // Silent for 500ms under a generous budget (a long test)...
    vi.advanceTimersByTime(500);
    // ...then the test finishes and the smaller idle budget applies, before
    // the delayed probe ack has arrived.
    watchdog.setBlockBudget({ ms: 100, label: 'idle' });
    vi.advanceTimersByTime(100);
    expect(onUnresponsive).not.toHaveBeenCalled();

    // A thread that stays silent still fails within the new budget.
    vi.advanceTimersByTime(10);
    expect(onUnresponsive).toHaveBeenCalledWith({ ms: 100, label: 'idle' });
  });

  it('stops on dispose', () => {
    const { sendProbe, onUnresponsive, watchdog } = setup(100);

    watchdog.dispose();
    vi.advanceTimersByTime(1_000);

    expect(sendProbe).not.toHaveBeenCalled();
    expect(onUnresponsive).not.toHaveBeenCalled();
  });
});

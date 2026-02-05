const GAP_BETWEEN_SCENES_SECONDS = 3;

export interface ReplayEvent {
  mqttTimestamp: number;
  topic: string;
  payload: unknown;
  id?: number;
  performanceId?: number;
}

export function computeCompressedEvents(
  rawEvents: ReplayEvent[],
  begin: number,
  end: number,
  deadSpaceSeconds: number
): { events: ReplayEvent[]; timestamp: { begin: number; end: number } } | null {
  const inRange = rawEvents.filter(
    (e) => e.mqttTimestamp >= begin && e.mqttTimestamp <= end
  );
  const sorted = [...inRange].sort((a, b) => a.mqttTimestamp - b.mqttTimestamp);
  if (sorted.length === 0) return null;

  const gapThresholdSeconds = Number(deadSpaceSeconds);
  const segments: Array<{ startTs: number; endTs: number; events: ReplayEvent[] }> = [];
  let seg = {
    startTs: sorted[0].mqttTimestamp,
    endTs: sorted[0].mqttTimestamp,
    events: [sorted[0]],
  };
  segments.push(seg);
  for (let i = 1; i < sorted.length; i++) {
    const ev = sorted[i];
    const gap = ev.mqttTimestamp - seg.endTs;
    if (gap > gapThresholdSeconds) {
      seg = {
        startTs: ev.mqttTimestamp,
        endTs: ev.mqttTimestamp,
        events: [ev],
      };
      segments.push(seg);
    } else {
      seg.endTs = ev.mqttTimestamp;
      seg.events.push(ev);
    }
  }
  let compressedStart = 0;
  const newEvents: ReplayEvent[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const duration = segment.endTs - segment.startTs;
    for (const event of segment.events) {
      newEvents.push({
        ...event,
        mqttTimestamp: compressedStart + (event.mqttTimestamp - segment.startTs),
      });
    }
    compressedStart += duration;
    if (i < segments.length - 1) {
      compressedStart += GAP_BETWEEN_SCENES_SECONDS;
    }
  }
  return {
    events: newEvents,
    timestamp: { begin: 0, end: compressedStart },
  };
}

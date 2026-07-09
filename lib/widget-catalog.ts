export interface WidgetMeta {
  id: string;
  label: string;
  group: 'core' | 'ext';
}

export const WIDGET_CATALOG: WidgetMeta[] = [
  { id: 'clock',         label: 'Saat',           group: 'core' },
  { id: 'cryptoForex',   label: 'Kripto / Forex', group: 'core' },
  { id: 'activityLog',   label: 'Activity',       group: 'core' },
  { id: 'weather',       label: 'Hava',           group: 'core' },
  { id: 'markets',       label: 'Markets',        group: 'core' },
  { id: 'systemHealth',  label: 'System Health',  group: 'core' },
  { id: 'systemStatus',  label: 'System Status',  group: 'core' },
  { id: 'battery',       label: 'Battery',        group: 'core' },
  { id: 'voiceTimeline', label: 'Voice & Tools',  group: 'core' },
  { id: 'latency',       label: 'Latency / Cost', group: 'core' },
  { id: 'controlPanel',  label: 'Controls',       group: 'core' },
  { id: 'subAgents',     label: 'Sub-Agents',     group: 'core' },
  { id: 'agentVoice',    label: 'Voice (TTS)',    group: 'core' },
  { id: 'pomodoro',      label: 'Pomodoro',       group: 'core' },
  { id: 'nowPlaying',    label: 'Now Playing',    group: 'core' },
  { id: 'health',        label: 'Health (WHOOP)', group: 'core' },
  { id: 'stockTicker',   label: 'Stocks',         group: 'core' },
  // Yeni — varsayılan kapalı, hamburger'dan açılır
  { id: 'memories',      label: 'Latest Memories',group: 'ext'  },
  { id: 'forecast',      label: 'Weather 5-day',  group: 'ext'  },
  { id: 'goals',         label: 'Daily Goals',    group: 'ext'  },
  { id: 'notion',        label: 'Notion Notes',   group: 'ext'  },
  { id: 'notes',         label: 'Apple Notes',    group: 'ext'  },
  { id: 'coach',         label: 'Ambient Coach',  group: 'ext'  },
  { id: 'calendarPrep',  label: 'Meeting Prep',   group: 'ext'  },
];

// Yeni eklenenler varsayılan kapalı
export const DEFAULT_HIDDEN: string[] = ['memories', 'forecast', 'goals', 'notion', 'notes', 'coach', 'calendarPrep'];
